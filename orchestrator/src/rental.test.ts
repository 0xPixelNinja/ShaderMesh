import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { ProjectionStore } from "./store";
import { dispatch } from "./indexer";

const E = (n: bigint) => (n * 10n ** 18n).toString();

describe("rental projection", () => {
  it("tracks listing, lease, heartbeat, settlement, and end via dispatch", () => {
    const s = new ProjectionStore();
    const em = new EventEmitter();

    dispatch(s, "Attested", { provider: "0xP", gpuModel: "RTX4090", vramGB: 24n, benchmarkScore: 1000n }, em);
    dispatch(s, "ListingCreated", {
      listingId: 1n, provider: "0xP", pricePerInterval: 10n ** 18n, intervalSecs: 600n,
      spec: JSON.stringify({ gpu: "RTX4090", vram: 24, region: "us-east", models: ["llama-3.1-8b"], endpoint: "http://p:8100" }),
    }, em);

    const listing = s.listListings()[0];
    expect(listing.gpu).toBe("RTX4090");
    expect(listing.models).toContain("llama-3.1-8b");
    expect(listing.endpoint).toBe("http://p:8100");

    dispatch(s, "LeaseOpened", { leaseId: 1n, listingId: 1n, requester: "0xR", provider: "0xP", fundedIntervals: 10n, escrow: 10n * 10n ** 18n }, em);
    let lease = s.getLease(1)!;
    expect(lease.status).toBe("Active");
    expect(lease.pricePerInterval).toBe(E(1n));

    dispatch(s, "Heartbeat", { leaseId: 1n, provider: "0xP", timestamp: 123n }, em);
    dispatch(s, "IntervalSettled", { leaseId: 1n, provider: "0xP", intervals: 3n, amount: 3n * 10n ** 18n }, em);
    lease = s.getLease(1)!;
    expect(lease.lastHeartbeat).toBe(123);
    expect(lease.settledIntervals).toBe(3);

    dispatch(s, "LeaseEnded", { leaseId: 1n, refunded: 7n * 10n ** 18n }, em);
    expect(s.getLease(1)!.status).toBe("Ended");

    const model = s.listModels().find((m) => m.model === "llama-3.1-8b")!;
    expect(model.providers).toBe(1);
    expect(s.listProviders()[0].attested).toBe(true);
  });

  it("routes a model to the cheapest provider with an endpoint", () => {
    const s = new ProjectionStore();
    const em = new EventEmitter();
    dispatch(s, "ListingCreated", { listingId: 1n, provider: "0xP", pricePerInterval: 5n, intervalSecs: 600n, spec: JSON.stringify({ models: ["m1"], endpoint: "http://p:8100" }) }, em);
    dispatch(s, "ListingCreated", { listingId: 2n, provider: "0xQ", pricePerInterval: 3n, intervalSecs: 600n, spec: JSON.stringify({ models: ["m1"], endpoint: "http://q:8100" }) }, em);
    const route = s.findEndpointForModel("m1");
    expect(route!.listing.provider).toBe("0xQ");
  });
});
