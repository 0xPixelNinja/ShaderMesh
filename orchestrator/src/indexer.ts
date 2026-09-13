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
  constructor(
    private market: Contract,
    private verification: Contract,
    private store: ProjectionStore,
    private emitter: EventEmitter
  ) {}

  async replay(fromBlock = 0): Promise<void> {
    const collected: { block: number; idx: number; name: string; args: Result }[] = [];
    for (const name of MARKET_EVENTS) {
      const logs = await this.market.queryFilter(this.market.filters[name](), fromBlock);
      for (const log of logs) collected.push({ block: log.blockNumber, idx: (log as any).index ?? 0, name, args: (log as any).args });
    }
    for (const name of VERIFICATION_EVENTS) {
      const logs = await this.verification.queryFilter(this.verification.filters[name](), fromBlock);
      for (const log of logs) collected.push({ block: log.blockNumber, idx: (log as any).index ?? 0, name, args: (log as any).args });
    }
    collected.sort((x, y) => (x.block - y.block) || (x.idx - y.idx));
    for (const e of collected) dispatch(this.store, e.name, e.args, this.emitter);
  }

  subscribe(): void {
    const listen = (contract: Contract, name: string) => {
      contract.on(name as any, (...cbArgs: any[]) => {
        const payload = cbArgs[cbArgs.length - 1];
        dispatch(this.store, name, payload?.args ?? {}, this.emitter);
      });
    };
    for (const name of MARKET_EVENTS) listen(this.market, name);
    for (const name of VERIFICATION_EVENTS) listen(this.verification, name);
  }

  async start(fromBlock = 0): Promise<void> {
    await this.replay(fromBlock);
    this.subscribe();
  }
}
