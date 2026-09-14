import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectionStore } from "./store";
import { LocalDirStorage } from "./storage";
import { JobService } from "./jobservice";
import { createApi } from "./api";
import { dispatch } from "./indexer";

let upstream: Server;
let orch: Server;
let base: string;

beforeAll(async () => {
  // A fake provider inference endpoint.
  upstream = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const body = JSON.parse(data || "{}");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "x", model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: "hi from provider" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => upstream.listen(0, r));
  const uport = (upstream.address() as AddressInfo).port;

  const store = new ProjectionStore();
  const em = new EventEmitter();
  dispatch(store, "ListingCreated", {
    listingId: 1n, provider: "0xP", pricePerInterval: 5n, intervalSecs: 600n,
    spec: JSON.stringify({ models: ["m1"], endpoint: `http://127.0.0.1:${uport}` }),
  }, em);

  const dir = mkdtempSync(join(tmpdir(), "sm-"));
  const svc = new JobService(new LocalDirStorage(join(dir, "s")), store);
  orch = createApi(store, svc, em);
  await new Promise<void>((r) => orch.listen(0, r));
  base = `http://127.0.0.1:${(orch.address() as AddressInfo).port}`;
});

afterAll(() => {
  orch.close();
  upstream.close();
});

describe("inference gateway", () => {
  it("routes a chat completion to a serving provider and tags routedTo", async () => {
    const r = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m1", messages: [{ role: "user", content: "hey" }] }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.choices[0].message.content).toBe("hi from provider");
    expect(j.routedTo).toBe("0xP");
  });

  it("returns 503 when no provider serves the model", async () => {
    const r = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "does-not-exist" }),
    });
    expect(r.status).toBe(503);
  });
});
