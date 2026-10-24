import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { ProjectionStore } from "./store";
import { dispatch, Indexer } from "./indexer";
import type { DeploymentIdentity, ProjectionPersistence } from "./persistence";
import { ServiceHealth } from "./health";

const identity: DeploymentIdentity = { chainId: "1", contracts: { JobMarket: "0xmarket" } };

function mockContract(logs: Record<string, any[]> = {}) {
  const allLogs = Object.entries(logs).flatMap(([name, entries]) =>
    entries.map((log) => ({ fragment: { name }, ...log }))
  );
  return {
    queryFilter: async (filter: string, from: number, to?: number) => {
      expect(filter).toBe("*");
      return allLogs.filter((log) => log.blockNumber >= from && (to === undefined || log.blockNumber <= to));
    },
  } as any;
}

describe("dispatch", () => {
  it("applies chain events to the store and forwards them", () => {
    const store = new ProjectionStore();
    const emitter = new EventEmitter();
    const seen: string[] = [];
    emitter.on("update", (u: { name: string }) => seen.push(u.name));

    dispatch(store, "JobPosted", { jobId: 1n, requester: "0xR", inputCID: "local://m", taskCount: 2n, rewardPerTask: 100n }, emitter);
    expect(store.getJob(1)!.taskCount).toBe(2);
    expect(store.getJob(1)!.rewardPerTask).toBe("100");

    dispatch(store, "TaskClaimed", { jobId: 1n, index: 0n, provider: "0xP" }, emitter);
    expect(store.getTask(1, 0)!.status).toBe("Claimed");

    dispatch(store, "ResultSubmitted", { jobId: 1n, index: 0n, provider: "0xP", resultHash: "0xhash", outputCID: "local://o" }, emitter);
    expect(store.getTask(1, 0)!.status).toBe("Submitted");

    dispatch(store, "TaskPaid", { jobId: 1n, index: 0n }, emitter);
    expect(store.getTask(1, 0)!.status).toBe("Paid");

    expect(seen).toContain("JobPosted");
    expect(seen).toContain("TaskPaid");
  });

  it("derives complete provider accounting with normalized address keys", () => {
    const store = new ProjectionStore();

    dispatch(store, "ProviderRegistered", {
      provider: "0xAbC",
      capabilities: JSON.stringify({ gpu: "RTX 4090", vram: 24, models: ["render-v1"] }),
    });
    dispatch(store, "Staked", { provider: "0xabc", amount: 100n, totalStake: 100n });
    dispatch(store, "Bonded", { provider: "0xABC", amount: 40n, totalBonded: 40n });
    dispatch(store, "Slashed", { provider: "0xabc", amount: 10n, beneficiary: "0xB" });
    dispatch(store, "Unbonded", { provider: "0xAbC", amount: 10n, totalBonded: 20n });
    dispatch(store, "Unstaked", { provider: "0xabc", amount: 10n, totalStake: 80n });
    dispatch(store, "ReputationUpdated", { provider: "0xABC", reputation: 6000n, success: true });
    dispatch(store, "ReputationUpdated", { provider: "0xabc", reputation: 4800n, success: false });
    dispatch(store, "ActiveSet", { provider: "0xAbC", active: false });
    dispatch(store, "Attested", { provider: "0xABC", gpuModel: "RTX 4090", vramGB: 24n, benchmarkScore: 987n });
    dispatch(store, "OfferCreated", { offerId: 1n, provider: "0xabc", modelIdentifier: "llama", pricePerToken: 2n });

    expect([...store.providers.keys()]).toEqual(["0xabc"]);
    expect(store.listProviders()[0]).toEqual({
      address: "0xabc",
      registered: true,
      active: false,
      stake: "80",
      bonded: "20",
      availableStake: "60",
      reputation: 4800,
      completed: 1,
      failed: 1,
      capabilities: JSON.stringify({ gpu: "RTX 4090", vram: 24, models: ["render-v1"] }),
      attested: true,
      gpu: "RTX 4090",
      vramGB: 24,
      benchmarkScore: "987",
      models: ["render-v1", "llama"],
      challengesPassed: 0,
      challengesFailed: 0,
      lastChallenge: null,
    });
  });

  it("indexes typed disputes and chronological JSON-safe event history", () => {
    const store = new ProjectionStore();
    dispatch(store, "DisputeOpened", {
      jobId: 2n, index: 1n, provider: "0xAbC", providerHash: "0xhash",
    }, undefined, { blockNumber: 8, logIndex: 2, transactionHash: "0xopen" });
    dispatch(store, "ChallengeVote", {
      jobId: 2n, index: 1n, challenger: "0xDEF", agree: false,
      nested: { amount: 3n },
    }, undefined, { blockNumber: 8, logIndex: 3, transactionHash: "0xvote" });
    dispatch(store, "DisputeResolved", {
      jobId: 2n, index: 1n, cheatingUpheld: true,
    }, undefined, { blockNumber: 9, logIndex: 0, transactionHash: "0xresolve" });

    expect(store.listDisputes()).toEqual([{
      jobId: 2,
      index: 1,
      provider: "0xabc",
      providerHash: "0xhash",
      status: "Resolved",
      agreeVotes: 0,
      disagreeVotes: 1,
      votes: [{ challenger: "0xdef", agree: false }],
      cheatingUpheld: true,
    }]);
    expect(store.listEventHistory(undefined, 2).map((event) => event.name)).toEqual([
      "ChallengeVote",
      "DisputeResolved",
    ]);
    expect(store.listEventHistory("ChallengeVote")[0]).toMatchObject({
      blockNumber: 8,
      logIndex: 3,
      transactionHash: "0xvote",
      payload: { nested: { amount: "3" } },
    });
  });

  it("uses one polling trigger instead of contract event subscriptions", async () => {
    vi.useFakeTimers();
    const contract = mockContract();
    contract.on = () => { throw new Error("event subscription should not be used"); };
    let headQueries = 0;
    const indexer = new Indexer(
      contract,
      contract,
      contract,
      contract,
      contract,
      new ProjectionStore(),
      new EventEmitter(),
      { pollIntervalMs: 100, getBlockNumber: async () => { headQueries++; return 0; } },
    );

    try {
      indexer.subscribe();
      indexer.subscribe();
      await vi.advanceTimersByTimeAsync(100);
      expect(headQueries).toBe(1);
    } finally {
      indexer.stop();
      vi.useRealTimers();
    }
  });

  it("restores a cursor, skips duplicates, and persists later events in chain order", async () => {
    const restored = new ProjectionStore();
    restored.onJobPosted(1, "0xR", "ipfs://input", 1, "10");
    const saves: { blockNumber: number; logIndex: number }[] = [];
    const persistence: ProjectionPersistence = {
      load: async () => ({ snapshot: restored.snapshot(), cursor: { blockNumber: 10, logIndex: 4 } }),
      save: async (_identity, _snapshot, cursor) => { saves.push(cursor!); },
    };
    const market = mockContract({
      TaskClaimed: [
        { blockNumber: 10, index: 3, transactionHash: "0xold", args: { jobId: 1n, index: 0n, provider: "old" } },
        { blockNumber: 10, index: 5, transactionHash: "0xclaim", args: { jobId: 1n, index: 0n, provider: "0xP" } },
      ],
      ResultSubmitted: [
        { blockNumber: 11, index: 1, transactionHash: "0xresult", args: { jobId: 1n, index: 0n, provider: "0xP", resultHash: "0xh", outputCID: "ipfs://out" } },
      ],
    });
    const inert = mockContract();
    const store = new ProjectionStore();
    const emitter = new EventEmitter();
    const published: string[] = [];
    emitter.on("update", ({ name }: { name: string }) => published.push(name));
    const indexer = new Indexer(market, inert, inert, inert, inert, store, emitter, {
      persistence,
      identity,
      getBlockNumber: async () => 11,
    });

    await indexer.start();
    await indexer.catchUp();
    indexer.stop();

    expect(saves).toEqual([
      { blockNumber: 10, logIndex: 5 },
      { blockNumber: 11, logIndex: 1 },
    ]);
    expect(store.getTask(1, 0)).toMatchObject({ status: "Submitted", provider: "0xP" });
    expect(store.listEventHistory().map(({ name, transactionHash }) => ({ name, transactionHash }))).toEqual([
      { name: "TaskClaimed", transactionHash: "0xclaim" },
      { name: "ResultSubmitted", transactionHash: "0xresult" },
    ]);
    expect(published).toEqual(["TaskClaimed", "ResultSubmitted"]);
  });

  it("queries each contract once per bounded block chunk", async () => {
    const calls: string[][] = Array.from({ length: 5 }, () => []);
    const contracts = calls.map((ranges) => ({
      queryFilter: async (filter: string, from: number, to?: number) => {
        expect(filter).toBe("*");
        ranges.push(`${from}-${to}`);
        return [];
      },
    } as any));
    const indexer = new Indexer(
      contracts[0],
      contracts[1],
      contracts[2],
      contracts[3],
      contracts[4],
      new ProjectionStore(),
      new EventEmitter(),
      { maxBlockRange: 10 },
    );

    await indexer.replay(100, 124);

    for (const ranges of calls) {
      expect(ranges).toEqual(["100-109", "110-119", "120-124"]);
    }
  });

  it("retries a rate-limited contract query", async () => {
    let attempts = 0;
    const market = mockContract();
    market.queryFilter = async () => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error("too many requests"), { status: 429 });
      return [];
    };
    const inert = mockContract();
    const indexer = new Indexer(market, inert, inert, inert, inert, new ProjectionStore(), new EventEmitter(), {
      rpcRetryAttempts: 2,
      rpcRetryIntervalMs: 0,
    });

    await indexer.replay(1, 1);

    expect(attempts).toBe(2);
  });

  it("degrades after exhausted RPC retries and recovers on a later success", async () => {
    const health = new ServiceHealth();
    let fail = true;
    const market = mockContract();
    market.queryFilter = async () => {
      if (fail) throw Object.assign(new Error("rate limit exceeded"), { code: -32005 });
      return [];
    };
    const inert = mockContract();
    const indexer = new Indexer(market, inert, inert, inert, inert, new ProjectionStore(), new EventEmitter(), {
      health,
      getBlockNumber: async () => 1,
      pollIntervalMs: 60_000,
      rpcRetryAttempts: 2,
      rpcRetryIntervalMs: 0,
    });

    await expect(indexer.start(1)).rejects.toThrow("rate limit exceeded");
    expect(health.report().status).toBe("degraded");

    fail = false;
    await indexer.catchUp();
    indexer.stop();
    expect(health.report()).toEqual({ status: "ok" });
  });

  it("degrades health and stops publishing when persistence fails", async () => {
    const health = new ServiceHealth();
    const persistence: ProjectionPersistence = {
      load: async () => null,
      save: async () => { throw new Error("database unavailable"); },
    };
    const market = mockContract({
      JobPosted: [{ blockNumber: 1, index: 0, args: {
        jobId: 1n, requester: "0xR", inputCID: "ipfs://input", taskCount: 1n, rewardPerTask: 10n,
      } }],
    });
    const inert = mockContract();
    const store = new ProjectionStore();
    const indexer = new Indexer(market, inert, inert, inert, inert, store, new EventEmitter(), {
      persistence,
      identity,
      health,
      getBlockNumber: async () => 1,
    });

    await expect(indexer.start()).rejects.toThrow("database unavailable");
    expect(store.getJob(1)).toBeNull();
    expect(health.report()).toEqual({
      status: "degraded",
      failures: { persistence: "database unavailable", indexing: "database unavailable" },
    });
  });
});
