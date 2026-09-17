import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { ProjectionStore } from "./store";
import { dispatch } from "./indexer";

const E = (n: bigint) => (n * 10n ** 18n).toString();

describe("rental projection", () => {
  it("tracks a requested, accepted, heartbeated, settled, and ended lease", () => {
    const s = new ProjectionStore();
    const em = new EventEmitter();
    const spec = JSON.stringify({
      gpu: "RTX4090",
      vram: 24,
      region: "us-east",
      models: ["llama-3.1-8b"],
      endpoint: "http://p:8100",
    });

    dispatch(s, "Attested", { provider: "0xP", gpuModel: "RTX4090", vramGB: 24n, benchmarkScore: 1000n }, em);
    dispatch(s, "ListingCreated", {
      listingId: 1n, provider: "0xP", pricePerInterval: 10n ** 18n, intervalSecs: 600n,
      minIntervals: 2n, maxIntervals: 12n, spec,
    }, em);

    const listing = s.listListings()[0];
    expect(listing.minIntervals).toBe(2);
    expect(listing.maxIntervals).toBe(12);
    expect(listing.available).toBe(true);
    expect(listing.activeLeaseId).toBe(0);
    expect(listing.spec).toBe(spec);
    expect(listing.gpu).toBe("RTX4090");
    expect(listing.models).toContain("llama-3.1-8b");
    expect(listing.endpoint).toBe("http://p:8100");

    dispatch(s, "LeaseRequested", {
      leaseId: 1n, listingId: 1n, requester: "0xR", provider: "0xP",
      fundedIntervals: 10n, escrow: 10n * 10n ** 18n, manifest: "ipfs://manifest",
    }, em);
    let lease = s.getLease(1)!;
    expect(lease.status).toBe("Pending");
    expect(lease.pricePerInterval).toBe(E(1n));
    expect(lease.maxIntervals).toBe(12);
    expect(lease.escrow).toBe(E(10n));
    expect(lease.manifest).toBe("ipfs://manifest");

    dispatch(s, "ListingAvailabilityChanged", { listingId: 1n, available: false, leaseId: 1n }, em);
    dispatch(s, "LeaseAccepted", { leaseId: 1n, provider: "0xP", start: 100n, bond: 50n * 10n ** 18n }, em);
    expect(s.listListings()).toEqual([]);
    expect(s.listListings(false)[0].activeLeaseId).toBe(1);
    expect(s.getLease(1)!.status).toBe("Active");
    expect(s.getLease(1)!.start).toBe(100);
    expect(s.getLease(1)!.bond).toBe(E(50n));

    dispatch(s, "Heartbeat", { leaseId: 1n, provider: "0xP", interval: 0n, timestamp: 123n }, em);
    dispatch(s, "IntervalSettled", { leaseId: 1n, provider: "0xP", intervals: 3n, amount: 3n * 10n ** 18n }, em);
    dispatch(s, "LeaseExtended", { leaseId: 1n, addedIntervals: 2n, addedEscrow: 2n * 10n ** 18n }, em);
    lease = s.getLease(1)!;
    expect(lease.lastHeartbeatInterval).toBe(0);
    expect(lease.heartbeatedIntervals).toBe(1);
    expect(lease.lastHeartbeat).toBe(123);
    expect(lease.settledIntervals).toBe(3);
    expect(lease.fundedIntervals).toBe(12);
    expect(lease.escrow).toBe(E(9n));

    dispatch(s, "ListingAvailabilityChanged", { listingId: 1n, available: true, leaseId: 1n }, em);
    dispatch(s, "LeaseEnded", { leaseId: 1n, refunded: 7n * 10n ** 18n }, em);
    expect(s.getLease(1)!.status).toBe("Ended");
    expect(s.getLease(1)!.escrow).toBe("0");
    expect(s.listListings()[0].activeLeaseId).toBe(0);

    const model = s.listModels().find((m) => m.model === "llama-3.1-8b")!;
    expect(model.providers).toBe(1);
    expect(s.listProviders()[0].attested).toBe(true);
  });

  it("tracks rejected, cancelled, and terminated statuses", () => {
    const s = new ProjectionStore();
    const em = new EventEmitter();
    dispatch(s, "ListingCreated", {
      listingId: 1n, provider: "0xP", pricePerInterval: 5n, intervalSecs: 600n,
      minIntervals: 1n, maxIntervals: 10n, spec: "{}",
    }, em);

    for (const leaseId of [1n, 2n, 3n]) {
      dispatch(s, "LeaseRequested", {
        leaseId, listingId: 1n, requester: "0xR", provider: "0xP",
        fundedIntervals: 2n, escrow: 10n, manifest: `manifest-${leaseId}`,
      }, em);
    }
    dispatch(s, "LeaseRejected", { leaseId: 1n, provider: "0xP", refunded: 10n }, em);
    dispatch(s, "LeaseCancelled", { leaseId: 2n, requester: "0xR", refunded: 10n }, em);
    dispatch(s, "LeaseAccepted", { leaseId: 3n, provider: "0xP", start: 100n, bond: 50n }, em);
    dispatch(s, "LeaseTerminated", { leaseId: 3n, slashed: 50n, refunded: 10n }, em);

    expect(s.getLease(1)!.status).toBe("Rejected");
    expect(s.getLease(2)!.status).toBe("Cancelled");
    expect(s.getLease(3)!.status).toBe("Terminated");
    expect(s.listLeases().map((lease) => lease.status)).toEqual(["Rejected", "Cancelled", "Terminated"]);
  });

  it("routes a model only through available listings", () => {
    const s = new ProjectionStore();
    const em = new EventEmitter();
    dispatch(s, "ListingCreated", { listingId: 1n, provider: "0xP", pricePerInterval: 5n, intervalSecs: 600n, minIntervals: 1n, maxIntervals: 10n, spec: JSON.stringify({ models: ["m1"], endpoint: "http://p:8100" }) }, em);
    dispatch(s, "ListingCreated", { listingId: 2n, provider: "0xQ", pricePerInterval: 3n, intervalSecs: 600n, minIntervals: 1n, maxIntervals: 10n, spec: JSON.stringify({ models: ["m1"], endpoint: "http://q:8100" }) }, em);
    const route = s.findEndpointForModel("m1");
    expect(route!.listing.provider).toBe("0xQ");

    dispatch(s, "ListingAvailabilityChanged", { listingId: 2n, available: false, leaseId: 7n }, em);
    expect(s.findEndpointForModel("m1")!.listing.provider).toBe("0xP");
    expect(s.listModels()[0].providers).toBe(1);

    dispatch(s, "ListingAvailabilityChanged", { listingId: 1n, available: false, leaseId: 0n }, em);
    expect(s.findEndpointForModel("m1")).toBeNull();
    expect(s.listModels()).toEqual([]);
  });
});
