import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { ProjectionStore } from "./store";
import { LocalDirStorage } from "./storage";
import { JobService } from "./jobservice";
import { createApi } from "./api";

let server: Server;
let base: string;

beforeAll(async () => {
  const store = new ProjectionStore();
  store.onJobPosted(1, "0xReq", "local://m", 2, "100");
  store.onTaskClaimed(1, 0, "0xP1");
  const dir = mkdtempSync(join(tmpdir(), "sm-"));
  const svc = new JobService(new LocalDirStorage(join(dir, "s")), store);
  server = createApi(store, svc, new EventEmitter());
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("api", () => {
  it("GET /health", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("ok");
  });

  it("GET /jobs lists jobs", async () => {
    const r = await fetch(`${base}/jobs`);
    const j = await r.json();
    expect(j.length).toBe(1);
    expect(j[0].id).toBe(1);
  });

  it("GET /jobs/1 returns job and tasks", async () => {
    const r = await fetch(`${base}/jobs/1`);
    const j = await r.json();
    expect(j.tasks.length).toBe(2);
    expect(j.tasks[0].status).toBe("Claimed");
  });

  it("GET /jobs/999 returns 404", async () => {
    const r = await fetch(`${base}/jobs/999`);
    expect(r.status).toBe(404);
  });

  it("POST /jobs/prepare splits and pins", async () => {
    const r = await fetch(`${base}/jobs/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spec: { width: 16, height: 16, re_min: -2, re_max: 1, im_min: -1.5, im_max: 1.5, max_iter: 20 },
        tilesX: 2,
        tilesY: 2,
      }),
    });
    const j = await r.json();
    expect(j.taskCount).toBe(4);
    expect(typeof j.inputCID).toBe("string");
  });
});
