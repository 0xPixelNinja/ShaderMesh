import { EventEmitter } from "node:events";
import type { Contract, Result } from "ethers";
import { ProjectionStore } from "./store";

/**
 * Reads ShaderMesh events from the chain and maintains the projection store.
 * It replays past events on startup (so the projection is rebuildable) and then
 * subscribes to new ones. `dispatch` is pure with respect to (store, emitter),
 * which makes it directly unit testable without a live chain.
 */

const MARKET_EVENTS = [
  "JobPosted",
  "TaskClaimed",
  "ResultSubmitted",
  "TaskPaid",
  "TaskSlashed",
  "TaskReopened",
  "JobCompleted",
];
const VERIFICATION_EVENTS = ["DisputeOpened", "DisputeResolved"];
const RENTAL_EVENTS = [
  "ListingCreated",
  "ListingActiveSet",
  "LeaseOpened",
  "Heartbeat",
  "IntervalSettled",
  "LeaseExtended",
  "LeaseEnded",
  "LeaseTerminated",
];
const REGISTRY_EVENTS = ["Attested", "ReputationUpdated"];

export function dispatch(store: ProjectionStore, name: string, args: Result | any, emitter?: EventEmitter): void {
  const a = args;
  switch (name) {
    case "JobPosted":
      store.onJobPosted(Number(a.jobId), a.requester, a.inputCID, Number(a.taskCount), a.rewardPerTask.toString());
      break;
    case "TaskClaimed":
      store.onTaskClaimed(Number(a.jobId), Number(a.index), a.provider);
      break;
    case "ResultSubmitted":
      store.onResultSubmitted(Number(a.jobId), Number(a.index), a.provider, String(a.resultHash), a.outputCID);
      break;
    case "TaskPaid":
      store.onTaskPaid(Number(a.jobId), Number(a.index));
      break;
    case "TaskReopened":
      store.onTaskReopened(Number(a.jobId), Number(a.index));
      break;
    case "DisputeOpened":
      store.onDisputeOpened(Number(a.jobId), Number(a.index));
      break;
    case "JobCompleted":
      store.onJobCompleted(Number(a.jobId));
      break;
    // --- rental market ---
    case "ListingCreated":
      store.onListingCreated(Number(a.listingId), a.provider, a.pricePerInterval.toString(), Number(a.intervalSecs), a.spec);
      break;
    case "ListingActiveSet":
      store.onListingActiveSet(Number(a.listingId), Boolean(a.active));
      break;
    case "LeaseOpened":
      store.onLeaseOpened(Number(a.leaseId), Number(a.listingId), a.requester, a.provider, Number(a.fundedIntervals), a.escrow.toString());
      break;
    case "Heartbeat":
      store.onHeartbeat(Number(a.leaseId), Number(a.timestamp));
      break;
    case "IntervalSettled":
      store.onIntervalSettled(Number(a.leaseId), Number(a.intervals));
      break;
    case "LeaseExtended":
      store.onLeaseExtended(Number(a.leaseId), Number(a.addedIntervals));
      break;
    case "LeaseEnded":
      store.onLeaseEnded(Number(a.leaseId));
      break;
    case "LeaseTerminated":
      store.onLeaseTerminated(Number(a.leaseId));
      break;
    // --- registry ---
    case "Attested":
      store.onAttested(a.provider, a.gpuModel, Number(a.vramGB));
      break;
    case "ReputationUpdated":
      store.onReputationUpdated(a.provider, Number(a.reputation));
      break;
    // TaskSlashed and DisputeResolved carry no additional projection state beyond
    // TaskReopened / payout, but are still forwarded to subscribers below.
    default:
      break;
  }
  emitter?.emit("update", { name, payload: serializable(a) });
}

/** Convert a Result / args object to a plain, JSON-serializable object. */
function serializable(a: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!a) return out;
  for (const k of Object.keys(a)) {
    if (/^\d+$/.test(k)) continue; // skip positional duplicates
    const v = a[k];
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

export class Indexer {
  private sources: { contract: Contract; events: string[] }[];

  constructor(
    market: Contract,
    verification: Contract,
    rental: Contract,
    registry: Contract,
    private store: ProjectionStore,
    private emitter: EventEmitter
  ) {
    this.sources = [
      { contract: market, events: MARKET_EVENTS },
      { contract: verification, events: VERIFICATION_EVENTS },
      { contract: rental, events: RENTAL_EVENTS },
      { contract: registry, events: REGISTRY_EVENTS },
    ];
  }

  async replay(fromBlock = 0): Promise<void> {
    const collected: { block: number; idx: number; name: string; args: Result }[] = [];
    for (const { contract, events } of this.sources) {
      for (const name of events) {
        const logs = await contract.queryFilter(contract.filters[name](), fromBlock);
        for (const log of logs) {
          collected.push({ block: log.blockNumber, idx: (log as any).index ?? 0, name, args: (log as any).args });
        }
      }
    }
    collected.sort((x, y) => x.block - y.block || x.idx - y.idx);
    for (const e of collected) dispatch(this.store, e.name, e.args, this.emitter);
  }

  subscribe(): void {
    for (const { contract, events } of this.sources) {
      for (const name of events) {
        contract.on(name as any, (...cbArgs: any[]) => {
          const payload = cbArgs[cbArgs.length - 1];
          dispatch(this.store, name, payload?.args ?? {}, this.emitter);
        });
      }
    }
  }

  async start(fromBlock = 0): Promise<void> {
    await this.replay(fromBlock);
    this.subscribe();
  }
}
