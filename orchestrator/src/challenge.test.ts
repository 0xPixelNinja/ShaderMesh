import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { ProjectionStore } from "./store";
import { dispatch, type EventMetadata } from "./indexer";
import { createApi } from "./api";
import { JobService } from "./jobservice";
import { LocalDirStorage } from "./storage";

const P = "0xAbC0000000000000000000000000000000000001";
const seed = "0x" + "11".repeat(32);
const hash = "0x" + "22".repeat(32);
const at = (blockNumber: number, tx: string, timestamp?: number): EventMetadata => ({
  blockNumber, logIndex: 0, transactionHash: tx, timestamp,
});

function setup(): ProjectionStore {
  const s = new ProjectionStore();
  dispatch(s, "ProviderRegistered", { provider: P, capabilities: "{}" });
  dispatch(s, "Staked", { provider: P, amount: 100n, totalStake: 100n });
  dispatch(s, "Attested", { provider: P, gpuModel: "RTX4090", vramGB: 24n, benchmarkScore: 1000n });
  return s;
}

function issue(s: ProjectionStore, id = 1n, em?: EventEmitter): void {
  dispatch(s, "ChallengeIssued", { id, provider: P, seed, deadline: 1600n }, em, at(10, "0xa", 1000));
}

describe("benchmark challenge projection", () => {
  it("tracks issue, respond, pass and refreshes the attestation", () => {
    const s = setup();
    const em = new EventEmitter();
    const seen: string[] = [];
    em.on("update", (u: { name: string }) => seen.push(u.name));

    issue(s, 1n, em);
    let c = s.getChallenge(1)!;
    expect(c).toMatchObject({ status: "open", provider: P.toLowerCase(), seed, issuedAt: 1000, deadline: 1600, score: null });
    expect(c.issued).toEqual({ blockNumber: 10, transactionHash: "0xa", timestamp: 1000 });

    dispatch(s, "ChallengeResponded", { id: 1n, provider: P, score: 990n, outputHash: hash }, em, at(11, "0xb", 1100));
    c = s.getChallenge(1)!;
    expect(c).toMatchObject({ status: "responded", score: "990", outputHash: hash });
    expect(c.responded?.transactionHash).toBe("0xb");

    dispatch(s, "ChallengeResolved", { id: 1n, provider: P, status: 3n, slashed: 0n }, em, at(12, "0xc", 1200));
    c = s.getChallenge(1)!;
    expect(c).toMatchObject({ status: "passed", slashed: "0" });
    expect(c.resolved).toEqual({ blockNumber: 12, transactionHash: "0xc", timestamp: 1200 });

    const p = s.listProviders()[0];
    expect(p.attested).toBe(true);
    expect(p.challengesPassed).toBe(1);
    expect(p.challengesFailed).toBe(0);
    expect(p.lastChallenge).toEqual({ id: 1, status: "passed" });
    expect(seen).toEqual(["ChallengeIssued", "ChallengeResponded", "ChallengeResolved"]);
  });

  it("slashes free stake only on a failed challenge and revokes attestation", () => {
    const s = setup();
    dispatch(s, "Bonded", { provider: P, amount: 30n, totalBonded: 30n });
    issue(s);
    dispatch(s, "ChallengeResponded", { id: 1n, provider: P, score: 1n, outputHash: hash }, undefined, at(11, "0xb"));
    dispatch(s, "AttestationRevoked", { provider: P });
    dispatch(s, "ChallengeResolved", { id: 1n, provider: P, status: 4n, slashed: 20n }, undefined, at(12, "0xc"));
    dispatch(s, "Slashed", { provider: P, amount: 20n, beneficiary: "0xT" }, undefined, at(12, "0xc"));

    expect(s.getChallenge(1)).toMatchObject({ status: "failed", slashed: "20" });
    const p = s.listProviders()[0];
    expect(p.attested).toBe(false);
    expect(p.challengesFailed).toBe(1);
    expect(p.lastChallenge).toEqual({ id: 1, status: "failed" });
    expect(p.stake).toBe("80");
    expect(p.bonded).toBe("30");
    expect(p.availableStake).toBe("50");

    // A bond slash in another transaction still reduces bonded stake.
    dispatch(s, "Slashed", { provider: P, amount: 10n, beneficiary: "0xT" }, undefined, at(13, "0xd"));
    expect(s.listProviders()[0].bonded).toBe("20");
  });

  it("fails an unanswered challenge and a later Attested restores the flag", () => {
    const s = setup();
    issue(s);
    dispatch(s, "AttestationRevoked", { provider: P });
    dispatch(s, "ChallengeResolved", { id: 1n, provider: P, status: 4n, slashed: 0n }, undefined, at(12, "0xc"));
    expect(s.getChallenge(1)).toMatchObject({ status: "failed", responded: null, score: null });
    expect(s.listProviders()[0].attested).toBe(false);
    dispatch(s, "Attested", { provider: P, gpuModel: "RTX4090", vramGB: 24n, benchmarkScore: 1000n });
    expect(s.listProviders()[0].attested).toBe(true);
  });

  it("lapses without penalty", () => {
    const s = setup();
    issue(s);
    dispatch(s, "ChallengeResponded", { id: 1n, provider: P, score: 990n, outputHash: hash });
    dispatch(s, "ChallengeResolved", { id: 1n, provider: P, status: 5n, slashed: 0n });
    expect(s.getChallenge(1)!.status).toBe("lapsed");
    const p = s.listProviders()[0];
    expect(p.attested).toBe(true);
    expect(p.challengesPassed + p.challengesFailed).toBe(0);
    expect(p.lastChallenge).toEqual({ id: 1, status: "lapsed" });
  });

  it("filters by provider and ignores events for unknown challenges", () => {
    const s = setup();
    issue(s, 1n);
    dispatch(s, "ChallengeResponded", { id: 99n, provider: P, score: 1n, outputHash: hash });
    expect(s.listChallenges()).toHaveLength(1);
    expect(s.listChallenges(P)).toHaveLength(1);
    expect(s.listChallenges("0xdead")).toHaveLength(0);
  });

  it("rebuilds from a snapshot and from an older snapshot without challenges", () => {
    const s = setup();
    issue(s);
    dispatch(s, "ChallengeResolved", { id: 1n, provider: P, status: 3n, slashed: 0n }, undefined, at(12, "0xc", 1200));
    const snapshot = JSON.parse(JSON.stringify(s.snapshot()));
    const restored = ProjectionStore.fromSnapshot(snapshot);
    expect(restored.snapshot()).toEqual(s.snapshot());

    // Replaying the same events into a fresh store yields the same projection.
    const replay = setup();
    issue(replay);
    dispatch(replay, "ChallengeResolved", { id: 1n, provider: P, status: 3n, slashed: 0n }, undefined, at(12, "0xc", 1200));
    expect(replay.snapshot()).toEqual(s.snapshot());

    delete snapshot.challenges;
    for (const p of snapshot.providers) {
      delete p.challengesPassed;
      delete p.challengesFailed;
      delete p.lastChallenge;
    }
    const old = ProjectionStore.fromSnapshot(snapshot);
    expect(old.listChallenges()).toEqual([]);
    expect(old.listProviders()[0]).toMatchObject({ challengesPassed: 0, challengesFailed: 0, lastChallenge: null });
  });
});

describe("challenge api", () => {
  it("serves collection, filter, detail, provider summary, and event history", async () => {
    const s = setup();
    issue(s, 1n);
    dispatch(s, "ChallengeResolved", { id: 1n, provider: P, status: 3n, slashed: 0n }, undefined, at(12, "0xc", 1200));
    const dir = mkdtempSync(join(tmpdir(), "sm-ch-"));
    const server = createApi(s, new JobService(new LocalDirStorage(join(dir, "s")), s), new EventEmitter());
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const all = await (await fetch(`${base}/challenges`)).json();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ id: 1, status: "passed" });
      expect(await (await fetch(`${base}/challenges?provider=${P}`)).json()).toHaveLength(1);
      expect(await (await fetch(`${base}/challenges?provider=0xdead`)).json()).toEqual([]);
      expect(await (await fetch(`${base}/challenges/1`)).json()).toMatchObject({ id: 1, seed });
      expect((await fetch(`${base}/challenges/2`)).status).toBe(404);
      const providers = await (await fetch(`${base}/providers`)).json();
      expect(providers[0]).toMatchObject({ attested: true, challengesPassed: 1, lastChallenge: { id: 1, status: "passed" } });
      const events = await (await fetch(`${base}/events/history?type=ChallengeIssued`)).json();
      expect(events).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});
