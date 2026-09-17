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
import { ServiceHealth } from "./health";

const requester = "0x0000000000000000000000000000000000000001";
const provider = "0x0000000000000000000000000000000000000002";

let server: Server;
let base: string;
let store: ProjectionStore;

beforeAll(async () => {
  store = new ProjectionStore();
  store.onJobPosted(1, "0xReq", "local://m", 2, "100");
  store.onTaskClaimed(1, 0, "0xP1");
  store.onDisputeOpened(1, 1, "0xP1", "0xhash");
  store.onChallengeVote(1, 1, "0xC1", false);
  store.onListingCreated(1, "0xP1", "1000000000000000000", 600, 2, 12, "{\"gpu\":\"RTX4090\"}");
  store.onProviderRegistered("0xP1", "{\"models\":[\"model-a\"]}");
  store.onStaked("0xp1", "100");
  store.onBonded("0xP1", "25");
  store.onLeaseRequested(1, 1, "0xReq", "0xP1", 2, "2000000000000000000", "ipfs://manifest");
  store.onOfferCreated("1", provider, "model-a", "7");
  store.onCreditOpened("1", "1", requester, provider, "7", "100");
  store.recordEvent({ name: "ProviderRegistered", blockNumber: 1, logIndex: 0, transactionHash: "0x1", payload: { provider: "0xp1" } });
  store.recordEvent({ name: "ChallengeVote", blockNumber: 2, logIndex: 1, transactionHash: "0x2", payload: { agree: false } });
  store.recordEvent({ name: "ChallengeVote", blockNumber: 3, logIndex: 0, transactionHash: "0x3", payload: { agree: true } });
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

  it("GET /health returns 503 when persistence or indexing is degraded", async () => {
    const health = new ServiceHealth();
    health.fail("indexing", new Error("cursor save failed"));
    const dir = mkdtempSync(join(tmpdir(), "sm-health-"));
    const svc = new JobService(new LocalDirStorage(join(dir, "s")), store);
    const degraded = createApi(store, svc, undefined, undefined, { health });
    await new Promise<void>((resolve) => degraded.listen(0, resolve));
    const response = await fetch(`http://127.0.0.1:${(degraded.address() as AddressInfo).port}/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      failures: { indexing: "cursor save failed" },
    });
    await new Promise<void>((resolve, reject) => degraded.close((error) => error ? reject(error) : resolve()));
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

  it("serves tasks and typed disputes", async () => {
    const tasks = await (await fetch(`${base}/tasks`)).json();
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toMatchObject({ jobId: 1, index: 1, status: "Disputed" });

    const disputes = await (await fetch(`${base}/disputes`)).json();
    expect(disputes).toEqual([expect.objectContaining({
      jobId: 1,
      index: 1,
      provider: "0xp1",
      status: "Open",
      disagreeVotes: 1,
      votes: [{ challenger: "0xc1", agree: false }],
    })]);
  });

  it("GET /jobs/999 returns 404", async () => {
    const r = await fetch(`${base}/jobs/999`);
    expect(r.status).toBe(404);
  });

  it("serializes rental bounds, availability, status, and amounts", async () => {
    const listings = await (await fetch(`${base}/listings`)).json();
    expect(listings[0]).toMatchObject({
      id: 1,
      minIntervals: 2,
      maxIntervals: 12,
      available: true,
      activeLeaseId: 0,
      pricePerInterval: "1000000000000000000",
    });

    const lease = await (await fetch(`${base}/leases/1`)).json();
    expect(lease).toMatchObject({
      id: 1,
      status: "Pending",
      escrow: "2000000000000000000",
      bond: "0",
      manifest: "ipfs://manifest",
      heartbeatedIntervals: 0,
    });
  });

  it("can include reserved listings for lease history", async () => {
    store.onListingAvailabilityChanged(1, false, 1);
    expect(await (await fetch(`${base}/listings`)).json()).toEqual([]);
    const listings = await (await fetch(`${base}/listings?all=true`)).json();
    expect(listings[0]).toMatchObject({ id: 1, available: false, activeLeaseId: 1 });
    store.onListingAvailabilityChanged(1, true, 1);
  });

  it("serves complete provider records", async () => {
    const providers = await (await fetch(`${base}/providers`)).json();
    expect(providers.find((entry: { address: string }) => entry.address === "0xp1")).toMatchObject({
      registered: true,
      active: true,
      stake: "100",
      bonded: "25",
      availableStake: "75",
      completed: 0,
      failed: 0,
      capabilities: "{\"models\":[\"model-a\"]}",
      models: ["model-a"],
    });
  });

  it("filters and limits chronological event history", async () => {
    const events = await (await fetch(`${base}/events/history?type=ChallengeVote&limit=1`)).json();
    expect(events).toEqual([{
      name: "ChallengeVote",
      blockNumber: 3,
      logIndex: 0,
      transactionHash: "0x3",
      payload: { agree: true },
    }]);
    expect((await fetch(`${base}/events/history?limit=0`)).status).toBe(400);
  });

  it("serves inference offers and credits with requester filtering", async () => {
    const offers = await (await fetch(`${base}/offers`)).json();
    expect(offers).toEqual([{
      id: "1",
      provider,
      modelIdentifier: "model-a",
      pricePerToken: "7",
      active: true,
    }]);
    expect(await (await fetch(`${base}/offers/1`)).json()).toEqual(offers[0]);

    const credits = await (await fetch(`${base}/credits?requester=${requester}`)).json();
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ id: "1", offerId: "1", escrow: "100", active: true });
    expect(await (await fetch(`${base}/credits?requester=invalid`)).status).toBe(400);
    expect(await (await fetch(`${base}/credits/999`)).status).toBe(404);
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
