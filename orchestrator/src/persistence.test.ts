import { describe, expect, it } from "vitest";
import { ProjectionStore } from "./store";
import { InMemoryReplayStore, deploymentKey } from "./persistence";
import { isAfterCursor } from "./indexer";

describe("projection snapshots", () => {
  it("roundtrips every projection collection without sharing mutable records", () => {
    const source = new ProjectionStore();
    source.onJobPosted(1, "0xRequester", "ipfs://input", 1, "10");
    source.onTaskClaimed(1, 0, "0xProvider");
    source.onListingCreated(2, "0xProvider", "5", 60, 1, 4, JSON.stringify({
      gpu: "GPU",
      vram: 24,
      region: "test",
      models: ["model-a"],
      endpoint: "http://provider:8000",
    }));
    source.onLeaseRequested(3, 2, "0xRequester", "0xProvider", 2, "10", "ipfs://manifest");
    source.onProviderRegistered("0xProvider", JSON.stringify({ models: ["model-a"] }));
    source.onStaked("0xProvider", "100");
    source.onBonded("0xProvider", "25");
    source.onReputationUpdated("0xProvider", 6000, true);
    source.onAttested("0xProvider", "GPU", 24, "900");
    source.onOfferCreated("4", "0xProvider", "model-a", "2");
    source.onCreditOpened("5", "4", "0xRequester", "0xProvider", "2", "20");
    source.onDisputeOpened(1, 0, "0xProvider", "0xhash");
    source.onChallengeVote(1, 0, "0xChallenger", false);
    source.recordEvent({
      name: "ChallengeVote",
      blockNumber: 12,
      logIndex: 4,
      transactionHash: "0xtx",
      payload: { jobId: "1", agree: false },
    });

    const snapshot = source.snapshot();
    const restored = ProjectionStore.fromSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.snapshot()).toEqual(snapshot);

    restored.getJob(1)!.completed = true;
    expect(source.getJob(1)!.completed).toBe(false);
  });
});

describe("event cursors", () => {
  it("accepts only events strictly after block and log position", () => {
    const cursor = { blockNumber: 10, logIndex: 4 };
    expect(isAfterCursor({ blockNumber: 10, logIndex: 3 }, cursor)).toBe(false);
    expect(isAfterCursor({ blockNumber: 10, logIndex: 4 }, cursor)).toBe(false);
    expect(isAfterCursor({ blockNumber: 10, logIndex: 5 }, cursor)).toBe(true);
    expect(isAfterCursor({ blockNumber: 11, logIndex: 0 }, cursor)).toBe(true);
    expect(isAfterCursor({ blockNumber: 9, logIndex: 99 }, cursor)).toBe(false);
  });

  it("keys snapshots by normalized chain and contract deployment", () => {
    expect(deploymentKey({ chainId: "31337", contracts: { B: "0xBB", A: "0xAA" } }))
      .toBe(deploymentKey({ chainId: "031337", contracts: { A: "0xaa", B: "0xbb" } }));
    expect(deploymentKey({ chainId: "31337", contracts: { A: "0xaa" }, deploymentId: "first" }))
      .not.toBe(deploymentKey({ chainId: "31337", contracts: { A: "0xaa" }, deploymentId: "second" }));
  });
});

describe("InMemoryReplayStore", () => {
  it("atomically consumes keys and permits reuse only after expiry cleanup", async () => {
    const store = new InMemoryReplayStore();
    const results = await Promise.all([
      store.consume("requester:id", 20, 10),
      store.consume("requester:id", 20, 10),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(await store.consume("requester:id", 30, 19)).toBe(false);
    expect(await store.consume("requester:id", 30, 20)).toBe(true);
  });
});
