import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import { ProjectionStore } from "./store";
import { LocalDirStorage } from "./storage";
import { JobService } from "./jobservice";
import { createApi } from "./api";
import { canonicalRequestAuthorization } from "./authorization";

const requester = Wallet.createRandom();
const creditedProvider = Wallet.createRandom();
const otherProvider = Wallet.createRandom();
const noRouteProvider = Wallet.createRandom();
const unsafeProtocolProvider = Wallet.createRandom();
const expiry = Math.floor(Date.now() / 1000) + 600;

let upstream: Server;
let orchestrator: Server;
let base: string;
let store: ProjectionStore;
let lastUpstreamBody: any;

async function bodyFor(
  requestId: string,
  options: {
    creditId?: string;
    model?: string;
    expiry?: number;
    requesterWallet?: { address: string; signMessage(message: string): Promise<string> };
    requesterAddress?: string;
    providerAddress?: string;
    content?: string;
  } = {}
) {
  const signer = options.requesterWallet ?? requester;
  const model = options.model ?? "model-a";
  const messages = [{ role: "user", content: options.content ?? "hello" }];
  const authorization = {
    creditId: options.creditId ?? "1",
    requestId,
    requester: options.requesterAddress ?? signer.address,
    provider: options.providerAddress ?? creditedProvider.address,
    model,
    expiry: options.expiry ?? expiry,
  };
  return {
    model,
    messages,
    authorization: {
      credit_id: authorization.creditId,
      request_id: authorization.requestId,
      requester: authorization.requester,
      provider: authorization.provider,
      expiry: authorization.expiry,
      signature: await signer.signMessage(canonicalRequestAuthorization(authorization, messages)),
    },
  };
}

async function post(body: unknown) {
  return fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      lastUpstreamBody = JSON.parse(data || "{}");
      if (lastUpstreamBody.model === "redirect-model") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        return res.end();
      }
      const reply = () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "completion-1",
          model: lastUpstreamBody.model,
          choices: [{ index: 0, message: { role: "assistant", content: "provider response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }));
      };
      if (lastUpstreamBody.model === "slow-model") setTimeout(reply, 150);
      else reply();
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;

  store = new ProjectionStore();
  const endpoint = `http://127.0.0.1:${upstreamPort}`;
  store.onListingCreated(1, otherProvider.address, "1", 600, 1, 10, JSON.stringify({ models: ["model-a"], endpoint }));
  store.onListingCreated(2, creditedProvider.address, "10", 600, 1, 10, JSON.stringify({ models: ["model-a", "slow-model", "redirect-model"], endpoint }));
  store.onListingCreated(3, noRouteProvider.address, "1", 600, 1, 10, JSON.stringify({ models: ["blocked-model"], endpoint: "http://169.254.169.254" }));
  store.onListingCreated(4, unsafeProtocolProvider.address, "1", 600, 1, 10, JSON.stringify({ models: ["ftp-model"], endpoint: "ftp://127.0.0.1" }));
  store.onOfferCreated("1", creditedProvider.address, "model-a", "7");
  store.onOfferCreated("2", creditedProvider.address, "slow-model", "7");
  store.onOfferCreated("3", noRouteProvider.address, "blocked-model", "7");
  store.onOfferCreated("4", noRouteProvider.address, "missing-model", "7");
  store.onOfferCreated("5", unsafeProtocolProvider.address, "ftp-model", "7");
  store.onOfferCreated("6", creditedProvider.address, "redirect-model", "7");
  store.onCreditOpened("1", "1", requester.address, creditedProvider.address, "7", "1000");
  store.onCreditOpened("2", "2", requester.address, creditedProvider.address, "7", "1000");
  store.onCreditOpened("3", "3", requester.address, noRouteProvider.address, "7", "1000");
  store.onCreditOpened("4", "4", requester.address, noRouteProvider.address, "7", "1000");
  store.onCreditOpened("5", "1", requester.address, creditedProvider.address, "7", "1");
  store.onCreditClosed("5", "0", "0", "0");
  store.onCreditOpened("6", "5", requester.address, unsafeProtocolProvider.address, "7", "1000");
  store.onCreditOpened("7", "6", requester.address, creditedProvider.address, "7", "1000");

  const dir = mkdtempSync(join(tmpdir(), "sm-"));
  const service = new JobService(new LocalDirStorage(join(dir, "s")), store);
  orchestrator = createApi(store, service, new EventEmitter(), undefined, {
    requestBodyLimitBytes: 2_048,
    providerFetchTimeoutMs: 30,
    providerHostAllowlist: ["127.0.0.1"],
  });
  await new Promise<void>((resolve) => orchestrator.listen(0, resolve));
  base = `http://127.0.0.1:${(orchestrator.address() as AddressInfo).port}`;
});

afterAll(() => {
  orchestrator.close();
  upstream.close();
});

describe("inference gateway", () => {
  it("verifies authorization, routes only to the credited provider, and returns usage metadata", async () => {
    const response = await post(await bodyFor("success-1"));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.choices[0].message.content).toBe("provider response");
    expect(json.usage.total_tokens).toBe(5);
    expect(json.credit).toMatchObject({
      id: "1",
      offerId: "1",
      requester: requester.address,
      provider: creditedProvider.address,
      model: "model-a",
      pricePerToken: "7",
      remainingEscrow: "1000",
      requestId: "success-1",
    });
    expect(lastUpstreamBody.authorization).toBeUndefined();
  });

  it("rejects missing, expired, and invalid signatures", async () => {
    expect((await post({ model: "model-a", messages: [] })).status).toBe(400);
    expect((await post(await bodyFor("expired", { expiry: Math.floor(Date.now() / 1000) - 1 }))).status).toBe(401);
    expect((await post(await bodyFor("wrong-signer", { requesterWallet: otherProvider, requesterAddress: requester.address }))).status).toBe(401);
  });

  it("rejects replayed request IDs", async () => {
    expect((await post(await bodyFor("replay"))).status).toBe(200);
    expect((await post(await bodyFor("replay"))).status).toBe(409);
  });

  it("rejects credit requester, provider, model, and active-state mismatches", async () => {
    expect((await post(await bodyFor("bad-requester", { requesterWallet: otherProvider }))).status).toBe(403);
    expect((await post(await bodyFor("bad-provider", { providerAddress: otherProvider.address }))).status).toBe(403);
    expect((await post(await bodyFor("bad-model", { model: "other-model" }))).status).toBe(403);
    expect((await post(await bodyFor("closed", { creditId: "5" }))).status).toBe(403);
  });

  it("rejects unallowlisted on-chain endpoints and missing credited-provider routes", async () => {
    expect((await post(await bodyFor("blocked-host", {
      creditId: "3",
      model: "blocked-model",
      providerAddress: noRouteProvider.address,
    }))).status).toBe(502);
    expect((await post(await bodyFor("missing-route", {
      creditId: "4",
      model: "missing-model",
      providerAddress: noRouteProvider.address,
    }))).status).toBe(503);
    expect((await post(await bodyFor("bad-protocol", {
      creditId: "6",
      model: "ftp-model",
      providerAddress: unsafeProtocolProvider.address,
    }))).status).toBe(502);
  });

  it("does not follow provider redirects around the host allowlist", async () => {
    expect((await post(await bodyFor("redirect", {
      creditId: "7",
      model: "redirect-model",
    }))).status).toBe(502);
  });

  it("times out slow providers", async () => {
    const response = await post(await bodyFor("timeout", { creditId: "2", model: "slow-model" }));
    expect(response.status).toBe(504);
  });

  it("enforces the configured request body limit", async () => {
    const response = await post(await bodyFor("oversized", { content: "x".repeat(3_000) }));
    expect(response.status).toBe(413);
  });
});
