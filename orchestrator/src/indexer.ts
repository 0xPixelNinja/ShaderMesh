import { EventEmitter } from "node:events";
import type { Contract, Result } from "ethers";
import { ProjectionStore, type JsonValue } from "./store";
import type { DeploymentIdentity, EventCursor, PersistedProjection, ProjectionPersistence } from "./persistence";
import type { ServiceHealth } from "./health";

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
const VERIFICATION_EVENTS = ["DisputeOpened", "ChallengeVote", "DisputeResolved"];
const RENTAL_EVENTS = [
  "ListingCreated",
  "ListingAvailabilityChanged",
  "LeaseRequested",
  "LeaseAccepted",
  "LeaseRejected",
  "LeaseCancelled",
  "Heartbeat",
  "IntervalSettled",
  "LeaseExtended",
  "LeaseEnded",
  "LeaseTerminated",
];
const REGISTRY_EVENTS = [
  "ProviderRegistered",
  "CapabilitiesUpdated",
  "Staked",
  "Unstaked",
  "Bonded",
  "Unbonded",
  "Slashed",
  "ReputationUpdated",
  "ActiveSet",
  "Attested",
];
const INFERENCE_EVENTS = ["OfferCreated", "OfferDeactivated", "CreditOpened", "UsageSettled", "CreditClosed"];

export interface EventMetadata extends EventCursor {
  transactionHash: string;
}

export function dispatch(
  store: ProjectionStore,
  name: string,
  args: Result | any,
  emitter?: EventEmitter,
  metadata?: EventMetadata
): void {
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
      store.onDisputeOpened(
        Number(a.jobId),
        Number(a.index),
        a.provider ?? "",
        a.providerHash === undefined ? "" : String(a.providerHash)
      );
      break;
    case "ChallengeVote":
      store.onChallengeVote(Number(a.jobId), Number(a.index), a.challenger, Boolean(a.agree));
      break;
    case "DisputeResolved":
      store.onDisputeResolved(Number(a.jobId), Number(a.index), Boolean(a.cheatingUpheld));
      break;
    case "JobCompleted":
      store.onJobCompleted(Number(a.jobId));
      break;
    // --- rental market ---
    case "ListingCreated":
      store.onListingCreated(
        Number(a.listingId),
        a.provider,
        a.pricePerInterval.toString(),
        Number(a.intervalSecs),
        Number(a.minIntervals),
        Number(a.maxIntervals),
        a.spec
      );
      break;
    case "ListingAvailabilityChanged":
      store.onListingAvailabilityChanged(Number(a.listingId), Boolean(a.available), Number(a.leaseId));
      break;
    case "LeaseRequested":
      store.onLeaseRequested(
        Number(a.leaseId),
        Number(a.listingId),
        a.requester,
        a.provider,
        Number(a.fundedIntervals),
        a.escrow.toString(),
        a.manifest
      );
      break;
    case "LeaseAccepted":
      store.onLeaseAccepted(Number(a.leaseId), Number(a.start), a.bond.toString());
      break;
    case "LeaseRejected":
      store.onLeaseRejected(Number(a.leaseId));
      break;
    case "LeaseCancelled":
      store.onLeaseCancelled(Number(a.leaseId));
      break;
    case "Heartbeat":
      store.onHeartbeat(Number(a.leaseId), Number(a.interval), Number(a.timestamp));
      break;
    case "IntervalSettled":
      store.onIntervalSettled(Number(a.leaseId), Number(a.intervals), a.amount.toString());
      break;
    case "LeaseExtended":
      store.onLeaseExtended(Number(a.leaseId), Number(a.addedIntervals), a.addedEscrow.toString());
      break;
    case "LeaseEnded":
      store.onLeaseEnded(Number(a.leaseId));
      break;
    case "LeaseTerminated":
      store.onLeaseTerminated(Number(a.leaseId));
      break;
    // --- registry ---
    case "ProviderRegistered":
      store.onProviderRegistered(a.provider, a.capabilities);
      break;
    case "CapabilitiesUpdated":
      store.onProviderCapabilitiesUpdated(a.provider, a.capabilities);
      break;
    case "Staked":
      store.onStaked(a.provider, a.totalStake.toString());
      break;
    case "Unstaked":
      store.onUnstaked(a.provider, a.totalStake.toString());
      break;
    case "Bonded":
      store.onBonded(a.provider, a.totalBonded.toString());
      break;
    case "Unbonded":
      store.onUnbonded(a.provider, a.totalBonded.toString());
      break;
    case "Slashed":
      store.onSlashed(a.provider, a.amount.toString());
      break;
    case "ActiveSet":
      store.onActiveSet(a.provider, Boolean(a.active));
      break;
    case "Attested":
      store.onAttested(a.provider, a.gpuModel, Number(a.vramGB), a.benchmarkScore?.toString() ?? "0");
      break;
    case "ReputationUpdated":
      store.onReputationUpdated(
        a.provider,
        Number(a.reputation),
        typeof a.success === "boolean" ? a.success : undefined
      );
      break;
    // --- inference market ---
    case "OfferCreated":
      store.onOfferCreated(a.offerId.toString(), a.provider, a.modelIdentifier, a.pricePerToken.toString());
      break;
    case "OfferDeactivated":
      store.onOfferDeactivated(a.offerId.toString());
      break;
    case "CreditOpened":
      store.onCreditOpened(
        a.creditId.toString(),
        a.offerId.toString(),
        a.requester,
        a.provider,
        a.pricePerToken.toString(),
        a.escrow.toString()
      );
      break;
    case "UsageSettled":
      store.onUsageSettled(
        a.creditId.toString(),
        a.promptTokens.toString(),
        a.completionTokens.toString(),
        a.payment.toString(),
        a.remainingEscrow.toString()
      );
      break;
    case "CreditClosed":
      store.onCreditClosed(
        a.creditId.toString(),
        a.promptTokens.toString(),
        a.completionTokens.toString(),
        a.totalPaid.toString()
      );
      break;
    // TaskSlashed carries no additional projection state beyond registry and task
    // events, but is still forwarded to subscribers below.
    default:
      break;
  }
  const payload = serializable(a);
  if (metadata) store.recordEvent({ name, ...metadata, payload });
  emitter?.emit("update", { name, payload });
}

/** Convert a Result / args object to a plain, JSON-serializable object. */
function serializable(a: any): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  if (!a) return out;
  const values = typeof a.toObject === "function" ? a.toObject() : a;
  for (const k of Object.keys(values)) {
    if (/^\d+$/.test(k)) continue; // skip positional duplicates
    const value = jsonSafe(values[k]);
    if (value !== undefined) out[k] = value;
  }
  return out;
}

function jsonSafe(value: unknown): JsonValue | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafe(item) ?? null);
  }
  if (typeof value === "object") {
    const object = typeof (value as any).toObject === "function" ? (value as any).toObject() : value;
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(object)) {
      if (/^\d+$/.test(key)) continue;
      const safe = jsonSafe(item);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  }
  return String(value);
}

export function isAfterCursor(candidate: EventCursor, cursor: EventCursor | null): boolean {
  return cursor === null
    || candidate.blockNumber > cursor.blockNumber
    || (candidate.blockNumber === cursor.blockNumber && candidate.logIndex > cursor.logIndex);
}

interface IndexedEvent {
  cursor: EventCursor;
  name: string;
  args: Result;
  transactionHash: string;
}

export interface IndexerOptions {
  persistence?: ProjectionPersistence;
  identity?: DeploymentIdentity;
  health?: ServiceHealth;
  getBlockNumber?: () => Promise<number>;
  maxBlockRange?: number;
  pollIntervalMs?: number;
  rpcRetryAttempts?: number;
  rpcRetryIntervalMs?: number;
}

export class Indexer {
  private sources: { contract: Contract; events: string[] }[];
  private cursor: EventCursor | null = null;
  private scannedThrough: number | null = null;
  private fromBlock = 0;
  private work: Promise<void> = Promise.resolve();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private catchUpInFlight: Promise<void> | null = null;

  constructor(
    market: Contract,
    verification: Contract,
    rental: Contract,
    registry: Contract,
    inference: Contract,
    private store: ProjectionStore,
    private emitter: EventEmitter,
    private options: IndexerOptions = {}
  ) {
    this.sources = [
      { contract: market, events: MARKET_EVENTS },
      { contract: verification, events: VERIFICATION_EVENTS },
      { contract: rental, events: RENTAL_EVENTS },
      { contract: registry, events: REGISTRY_EVENTS },
      { contract: inference, events: INFERENCE_EVENTS },
    ];
    if (options.persistence && !options.identity) {
      throw new Error("deployment identity is required with projection persistence");
    }
    if (options.maxBlockRange !== undefined && (!Number.isSafeInteger(options.maxBlockRange) || options.maxBlockRange < 1)) {
      throw new Error("max block range must be a positive integer");
    }
    if (options.pollIntervalMs !== undefined && (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs < 1)) {
      throw new Error("poll interval must be a positive integer");
    }
    if (options.rpcRetryAttempts !== undefined && (!Number.isSafeInteger(options.rpcRetryAttempts) || options.rpcRetryAttempts < 1)) {
      throw new Error("RPC retry attempts must be a positive integer");
    }
    if (options.rpcRetryIntervalMs !== undefined
      && (!Number.isSafeInteger(options.rpcRetryIntervalMs) || options.rpcRetryIntervalMs < 0)) {
      throw new Error("RPC retry interval must be a non-negative integer");
    }
  }

  private async collect(fromBlock: number, toBlock?: number): Promise<IndexedEvent[]> {
    const collected: IndexedEvent[] = [];
    for (const { contract, events } of this.sources) {
      const logs = await this.retryRpc(() => contract.queryFilter("*", fromBlock, toBlock));
      const knownEvents = new Set(events);
      for (const log of logs) {
        let name = (log as any).fragment?.name as string | undefined;
        let args = (log as any).args as Result | undefined;
        if ((!name || !args) && (log as any).topics && contract.interface) {
          try {
            const parsed = contract.interface.parseLog(log as any);
            name = parsed?.name;
            args = parsed?.args;
          } catch {
            continue;
          }
        }
        if (!name || !args || !knownEvents.has(name)) continue;
        collected.push({
          cursor: { blockNumber: log.blockNumber, logIndex: (log as any).index ?? 0 },
          name,
          args,
          transactionHash: (log as any).transactionHash ?? "",
        });
      }
    }
    return collected.sort((left, right) =>
      left.cursor.blockNumber - right.cursor.blockNumber
      || left.cursor.logIndex - right.cursor.logIndex
    );
  }

  private async apply(event: IndexedEvent): Promise<void> {
    if (!isAfterCursor(event.cursor, this.cursor)) return;
    const persistence = this.options.persistence;
    const metadata = { ...event.cursor, transactionHash: event.transactionHash };
    if (!persistence) {
      dispatch(this.store, event.name, event.args, this.emitter, metadata);
      this.cursor = event.cursor;
      return;
    }

    const next = ProjectionStore.fromSnapshot(this.store.snapshot());
    dispatch(next, event.name, event.args, undefined, metadata);
    try {
      await persistence.save(this.options.identity!, next.snapshot(), event.cursor);
      this.options.health?.recover("persistence");
    } catch (error) {
      this.options.health?.fail("persistence", error);
      throw error;
    }
    this.store.restore(next.snapshot());
    this.cursor = event.cursor;
    this.emitter.emit("update", { name: event.name, payload: serializable(event.args) });
  }

  private serialized(operation: () => Promise<void>): Promise<void> {
    const result = this.work.then(operation);
    this.work = result.catch(() => undefined);
    return result;
  }

  private async retryRpc<T>(operation: () => Promise<T>): Promise<T> {
    return withRpcRetry(
      operation,
      this.options.rpcRetryAttempts ?? 3,
      this.options.rpcRetryIntervalMs ?? 1_000,
    );
  }

  private recordFailure(error: unknown): void {
    this.options.health?.fail("indexing", error);
    console.error("[orchestrator] indexing failed:", error);
  }

  private async replayRange(fromBlock: number, toBlock?: number): Promise<void> {
    let effectiveFrom = this.cursor ? Math.max(fromBlock, this.cursor.blockNumber) : fromBlock;
    if (this.scannedThrough !== null) effectiveFrom = Math.max(effectiveFrom, this.scannedThrough + 1);
    if (toBlock === undefined) {
      for (const event of await this.collect(effectiveFrom)) await this.apply(event);
      return;
    }

    const range = this.options.maxBlockRange ?? 2_000;
    for (let start = effectiveFrom; start <= toBlock; start += range) {
      const end = Math.min(start + range - 1, toBlock);
      for (const event of await this.collect(start, end)) await this.apply(event);
      this.scannedThrough = end;
    }
  }

  async replay(fromBlock = 0, toBlock?: number): Promise<void> {
    try {
      await this.serialized(() => this.replayRange(fromBlock, toBlock));
      this.options.health?.recover("indexing");
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  subscribe(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.triggerCatchUp().catch(() => undefined);
    }, this.options.pollIntervalMs ?? 4_000);
    this.pollTimer.unref();
  }

  stop(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private triggerCatchUp(): Promise<void> {
    if (this.catchUpInFlight) return this.catchUpInFlight;
    const result = this.catchUp();
    this.catchUpInFlight = result.finally(() => {
      this.catchUpInFlight = null;
    });
    return this.catchUpInFlight;
  }

  async catchUp(): Promise<void> {
    if (!this.options.getBlockNumber) return;
    try {
      await this.serialized(async () => {
        const head = await this.retryRpc(this.options.getBlockNumber!);
        await this.replayRange(this.fromBlock, head);
      });
      this.options.health?.recover("indexing");
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  async persistCurrentSnapshot(): Promise<void> {
    if (!this.options.persistence) return;
    try {
      await this.serialized(async () => {
        try {
          await this.options.persistence!.save(this.options.identity!, this.store.snapshot(), this.cursor);
          this.options.health?.recover("persistence");
        } catch (error) {
          this.options.health?.fail("persistence", error);
          throw error;
        }
      });
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  async start(fromBlock = 0): Promise<void> {
    this.fromBlock = fromBlock;
    try {
      if (this.options.persistence) {
        let saved: PersistedProjection | null;
        try {
          saved = await this.options.persistence.load(this.options.identity!);
          this.options.health?.recover("persistence");
        } catch (error) {
          this.options.health?.fail("persistence", error);
          throw error;
        }
        if (saved) {
          if (saved.snapshot.version === 2) {
            this.store.restore(saved.snapshot);
            this.cursor = saved.cursor;
          } else {
            console.log("[orchestrator] rebuilding legacy projection snapshot");
          }
        }
      }
      const replayHead = this.options.getBlockNumber
        ? await this.retryRpc(this.options.getBlockNumber)
        : undefined;
      await this.replay(fromBlock, replayHead);
      this.subscribe();
      // Polling starts before the second head read, closing the startup replay race.
      // Cursor filtering makes an overlapping range safe if one is required.
      await this.triggerCatchUp();
      if (this.options.persistence && this.cursor === null) await this.persistCurrentSnapshot();
      this.options.health?.recover("indexing");
    } catch (error) {
      this.recordFailure(error);
      if (this.options.getBlockNumber && isTransientRpcError(error)) this.subscribe();
      throw error;
    }
  }
}

export async function withRpcRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
  intervalMs = 1_000,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isTransientRpcError(error)) throw error;
      const delay = Math.min(intervalMs * 2 ** (attempt - 1), intervalMs * 8);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function isTransientRpcError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const value = pending.shift();
    if (value === null || value === undefined || seen.has(value)) continue;
    seen.add(value);
    if (typeof value === "string") {
      if (/\b429\b|rate.?limit|too many requests|request limit|timed? out|timeout|temporar|network|socket|connection (?:reset|refused)|service unavailable|gateway timeout|failed to fetch/i.test(value)) {
        return true;
      }
      continue;
    }
    if (typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const status = Number(record.status ?? record.statusCode);
    if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
    if (record.code === 429 || record.code === -32603 || record.code === -32005 || record.code === -32016) return true;
    if (["SERVER_ERROR", "NETWORK_ERROR", "TIMEOUT", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"]
      .includes(String(record.code))) return true;
    for (const key of ["message", "shortMessage", "reason", "cause", "error", "info", "response"]) {
      if (record[key] !== undefined) pending.push(record[key]);
    }
  }
  return false;
}
