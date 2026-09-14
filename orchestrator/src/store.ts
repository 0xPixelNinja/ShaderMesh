/**
 * In-memory projection of on-chain state. It is a derived, rebuildable view of
 * the chain (the source of truth), updated by replaying and subscribing to
 * events. Postgres persistence is a follow-up; the projection replays from chain
 * history on startup, which satisfies the rebuildable requirement.
 */

export type TaskStatus = "Open" | "Claimed" | "Submitted" | "Disputed" | "Paid";

export interface TaskRecord {
  jobId: number;
  index: number;
  provider: string | null;
  status: TaskStatus;
  resultHash: string | null;
  outputCID: string | null;
}

export interface JobRecord {
  id: number;
  requester: string;
  inputCID: string;
  taskCount: number;
  rewardPerTask: string;
  completedTasks: number;
  completed: boolean;
  resultCID: string | null;
}

export type LeaseStatus = "Active" | "Ended" | "Terminated";

export interface ListingRecord {
  id: number;
  provider: string;
  pricePerInterval: string; // token base units; 1 SMESH = $1
  intervalSecs: number;
  minIntervals: number;
  maxIntervals: number;
  active: boolean;
  gpu: string;
  vramGB: number;
  region: string;
  models: string[];
  endpoint: string | null; // provider inference endpoint, from spec
}

export interface LeaseRecord {
  id: number;
  listingId: number;
  requester: string;
  provider: string;
  pricePerInterval: string;
  intervalSecs: number;
  fundedIntervals: number;
  settledIntervals: number;
  lastHeartbeat: number;
  status: LeaseStatus;
}

export interface ProviderRecord {
  address: string;
  reputation: number;
  attested: boolean;
  gpu: string;
  vramGB: number;
  models: string[];
}

export class ProjectionStore {
  readonly jobs = new Map<number, JobRecord>();
  readonly tasks = new Map<string, TaskRecord>();
  readonly listings = new Map<number, ListingRecord>();
  readonly leases = new Map<number, LeaseRecord>();
  readonly providers = new Map<string, ProviderRecord>();

  private key(jobId: number, index: number): string {
    return `${jobId}:${index}`;
  }

  private provider(address: string): ProviderRecord {
    let p = this.providers.get(address);
    if (!p) {
      p = { address, reputation: 5000, attested: false, gpu: "", vramGB: 0, models: [] };
      this.providers.set(address, p);
    }
    return p;
  }

  onJobPosted(id: number, requester: string, inputCID: string, taskCount: number, rewardPerTask: string): void {
    this.jobs.set(id, {
      id,
      requester,
      inputCID,
      taskCount,
      rewardPerTask,
      completedTasks: 0,
      completed: false,
      resultCID: null,
    });
    for (let i = 0; i < taskCount; i++) {
      this.tasks.set(this.key(id, i), {
        jobId: id,
        index: i,
        provider: null,
        status: "Open",
        resultHash: null,
        outputCID: null,
      });
    }
  }

  onTaskClaimed(id: number, index: number, provider: string): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) {
      t.provider = provider;
      t.status = "Claimed";
    }
  }

  onResultSubmitted(id: number, index: number, provider: string, resultHash: string, outputCID: string): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) {
      t.provider = provider;
      t.resultHash = resultHash;
      t.outputCID = outputCID;
      t.status = "Submitted";
    }
  }

  onDisputeOpened(id: number, index: number): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) t.status = "Disputed";
  }

  onTaskPaid(id: number, index: number): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) t.status = "Paid";
    const j = this.jobs.get(id);
    if (j) j.completedTasks += 1;
  }

  onTaskReopened(id: number, index: number): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) {
      t.status = "Open";
      t.provider = null;
      t.resultHash = null;
      t.outputCID = null;
    }
  }

  onJobCompleted(id: number): void {
    const j = this.jobs.get(id);
    if (j) j.completed = true;
  }

  setJobResult(id: number, resultCID: string): void {
    const j = this.jobs.get(id);
    if (j) j.resultCID = resultCID;
  }

  getJob(id: number): JobRecord | null {
    return this.jobs.get(id) ?? null;
  }

  listJobs(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => a.id - b.id);
  }

  getTask(id: number, index: number): TaskRecord | null {
    return this.tasks.get(this.key(id, index)) ?? null;
  }

  listTasks(jobId: number): TaskRecord[] {
    return [...this.tasks.values()]
      .filter((t) => t.jobId === jobId)
      .sort((a, b) => a.index - b.index);
  }

  // --------------------------------------------------------------------- //
  // Rental market
  // --------------------------------------------------------------------- //

  onListingCreated(id: number, provider: string, pricePerInterval: string, intervalSecs: number, spec: string): void {
    let gpu = "", region = "", endpoint: string | null = null, models: string[] = [];
    let vramGB = 0, minIntervals = 1, maxIntervals = 168;
    try {
      const s = JSON.parse(spec || "{}");
      gpu = s.gpu ?? "";
      region = s.region ?? "";
      vramGB = Number(s.vram ?? 0);
      endpoint = s.endpoint ?? null;
      models = Array.isArray(s.models) ? s.models : [];
    } catch {
      // spec is free form; ignore parse errors
    }
    this.listings.set(id, {
      id, provider, pricePerInterval, intervalSecs, minIntervals, maxIntervals,
      active: true, gpu, vramGB, region, models, endpoint,
    });
    const p = this.provider(provider);
    p.models = Array.from(new Set([...p.models, ...models]));
    if (gpu) p.gpu = gpu;
    if (vramGB) p.vramGB = vramGB;
  }

  onListingActiveSet(id: number, active: boolean): void {
    const l = this.listings.get(id);
    if (l) l.active = active;
  }

  onLeaseOpened(id: number, listingId: number, requester: string, provider: string, fundedIntervals: number, escrow: string): void {
    const listing = this.listings.get(listingId);
    const pricePerInterval = listing
      ? listing.pricePerInterval
      : fundedIntervals > 0
        ? (BigInt(escrow) / BigInt(fundedIntervals)).toString()
        : "0";
    const intervalSecs = listing ? listing.intervalSecs : 0;
    this.leases.set(id, {
      id, listingId, requester, provider, pricePerInterval, intervalSecs,
      fundedIntervals, settledIntervals: 0, lastHeartbeat: 0, status: "Active",
    });
  }

  onHeartbeat(leaseId: number, timestamp: number): void {
    const l = this.leases.get(leaseId);
    if (l) l.lastHeartbeat = timestamp;
  }

  onIntervalSettled(leaseId: number, intervals: number): void {
    const l = this.leases.get(leaseId);
    if (l) l.settledIntervals += intervals;
  }

  onLeaseExtended(leaseId: number, addedIntervals: number): void {
    const l = this.leases.get(leaseId);
    if (l) l.fundedIntervals += addedIntervals;
  }

  onLeaseEnded(leaseId: number): void {
    const l = this.leases.get(leaseId);
    if (l) l.status = "Ended";
  }

  onLeaseTerminated(leaseId: number): void {
    const l = this.leases.get(leaseId);
    if (l) l.status = "Terminated";
  }

  // --------------------------------------------------------------------- //
  // Provider profile (from registry events)
  // --------------------------------------------------------------------- //

  onAttested(provider: string, gpuModel: string, vramGB: number): void {
    const p = this.provider(provider);
    p.attested = true;
    if (gpuModel) p.gpu = gpuModel;
    if (vramGB) p.vramGB = vramGB;
  }

  onReputationUpdated(provider: string, reputation: number): void {
    this.provider(provider).reputation = reputation;
  }

  // --------------------------------------------------------------------- //
  // Rental getters
  // --------------------------------------------------------------------- //

  listListings(activeOnly = true): ListingRecord[] {
    return [...this.listings.values()]
      .filter((l) => (activeOnly ? l.active : true))
      .sort((a, b) => a.id - b.id);
  }

  getLease(id: number): LeaseRecord | null {
    return this.leases.get(id) ?? null;
  }

  listLeases(): LeaseRecord[] {
    return [...this.leases.values()].sort((a, b) => a.id - b.id);
  }

  listProviders(): ProviderRecord[] {
    return [...this.providers.values()].sort((a, b) => b.reputation - a.reputation);
  }

  /** Aggregate models across active listings with the lowest observed price. */
  listModels(): { model: string; minPricePerInterval: string; providers: number }[] {
    const agg = new Map<string, { min: bigint; providers: Set<string> }>();
    for (const l of this.listings.values()) {
      if (!l.active) continue;
      for (const m of l.models) {
        const cur = agg.get(m) ?? { min: BigInt(l.pricePerInterval), providers: new Set() };
        const price = BigInt(l.pricePerInterval);
        if (price < cur.min) cur.min = price;
        cur.providers.add(l.provider);
        agg.set(m, cur);
      }
    }
    return [...agg.entries()].map(([model, v]) => ({
      model,
      minPricePerInterval: v.min.toString(),
      providers: v.providers.size,
    }));
  }

  /** Find an active listing serving a model, preferring the cheapest with an endpoint. */
  findEndpointForModel(model: string): { listing: ListingRecord } | null {
    const candidates = [...this.listings.values()]
      .filter((l) => l.active && l.endpoint && l.models.includes(model))
      .sort((a, b) => (BigInt(a.pricePerInterval) < BigInt(b.pricePerInterval) ? -1 : 1));
    return candidates.length ? { listing: candidates[0] } : null;
  }
}
