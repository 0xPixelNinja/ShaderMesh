/** In-memory, rebuildable projection of on-chain state. */

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

export type LeaseStatus = "Pending" | "Active" | "Ended" | "Terminated" | "Rejected" | "Cancelled";

export interface ListingRecord {
  id: number;
  provider: string;
  pricePerInterval: string; // token base units; 1 SMESH = $1
  intervalSecs: number;
  minIntervals: number;
  maxIntervals: number;
  available: boolean;
  activeLeaseId: number;
  spec: string;
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
  start: number;
  fundedIntervals: number;
  maxIntervals: number;
  heartbeatedIntervals: number;
  settledIntervals: number;
  escrow: string;
  bond: string;
  lastHeartbeatInterval: number | null;
  lastHeartbeat: number;
  status: LeaseStatus;
  manifest: string;
}

export interface ProviderRecord {
  address: string;
  registered: boolean;
  active: boolean;
  stake: string;
  bonded: string;
  availableStake: string;
  reputation: number;
  completed: number;
  failed: number;
  capabilities: string;
  attested: boolean;
  gpu: string;
  vramGB: number;
  benchmarkScore: string;
  models: string[];
}

export interface ChallengeVoteRecord {
  challenger: string;
  agree: boolean;
}

export type DisputeStatus = "Open" | "Resolved";

export interface DisputeRecord {
  jobId: number;
  index: number;
  provider: string;
  providerHash: string;
  status: DisputeStatus;
  agreeVotes: number;
  disagreeVotes: number;
  votes: ChallengeVoteRecord[];
  cheatingUpheld: boolean | null;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface EventHistoryRecord {
  name: string;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  payload: { [key: string]: JsonValue };
}

export const EVENT_HISTORY_CAPACITY = 1_000;

export interface InferenceOfferRecord {
  id: string;
  provider: string;
  modelIdentifier: string;
  pricePerToken: string;
  active: boolean;
}

export interface InferenceCreditRecord {
  id: string;
  offerId: string;
  requester: string;
  provider: string;
  pricePerToken: string;
  escrow: string;
  paid: string;
  promptTokens: string;
  completionTokens: string;
  active: boolean;
}

export interface ProjectionSnapshot {
  version: 2;
  jobs: JobRecord[];
  tasks: TaskRecord[];
  listings: ListingRecord[];
  leases: LeaseRecord[];
  providers: ProviderRecord[];
  offers: InferenceOfferRecord[];
  credits: InferenceCreditRecord[];
  disputes: DisputeRecord[];
  eventHistory: EventHistoryRecord[];
}

export interface LegacyProjectionSnapshot extends Omit<ProjectionSnapshot, "version" | "providers" | "disputes" | "eventHistory"> {
  version: 1;
  providers: Array<Pick<ProviderRecord, "address" | "reputation" | "attested" | "gpu" | "vramGB" | "models">>;
}

export type RestorableProjectionSnapshot = ProjectionSnapshot | LegacyProjectionSnapshot;

export class ProjectionStore {
  readonly jobs = new Map<number, JobRecord>();
  readonly tasks = new Map<string, TaskRecord>();
  readonly listings = new Map<number, ListingRecord>();
  readonly leases = new Map<number, LeaseRecord>();
  readonly providers = new Map<string, ProviderRecord>();
  readonly offers = new Map<string, InferenceOfferRecord>();
  readonly credits = new Map<string, InferenceCreditRecord>();
  readonly disputes = new Map<string, DisputeRecord>();
  readonly eventHistory: EventHistoryRecord[] = [];

  snapshot(): ProjectionSnapshot {
    return {
      version: 2,
      jobs: structuredClone([...this.jobs.values()]),
      tasks: structuredClone([...this.tasks.values()]),
      listings: structuredClone([...this.listings.values()]),
      leases: structuredClone([...this.leases.values()]),
      providers: structuredClone([...this.providers.values()]),
      offers: structuredClone([...this.offers.values()]),
      credits: structuredClone([...this.credits.values()]),
      disputes: structuredClone([...this.disputes.values()]),
      eventHistory: structuredClone(this.eventHistory),
    };
  }

  restore(snapshot: RestorableProjectionSnapshot): void {
    if (snapshot.version !== 1 && snapshot.version !== 2) {
      throw new Error(`unsupported projection snapshot version ${(snapshot as { version: number }).version}`);
    }
    this.jobs.clear();
    this.tasks.clear();
    this.listings.clear();
    this.leases.clear();
    this.providers.clear();
    this.offers.clear();
    this.credits.clear();
    this.disputes.clear();
    this.eventHistory.length = 0;
    for (const record of structuredClone(snapshot.jobs)) this.jobs.set(record.id, record);
    for (const record of structuredClone(snapshot.tasks)) this.tasks.set(this.key(record.jobId, record.index), record);
    for (const record of structuredClone(snapshot.listings)) this.listings.set(record.id, record);
    for (const record of structuredClone(snapshot.leases)) this.leases.set(record.id, record);
    for (const record of structuredClone(snapshot.providers)) {
      const address = this.normalizeAddress(record.address);
      const stake = "stake" in record ? record.stake : "0";
      const bonded = "bonded" in record ? record.bonded : "0";
      this.providers.set(address, {
        address,
        registered: "registered" in record ? record.registered : false,
        active: "active" in record ? record.active : false,
        stake,
        bonded,
        availableStake: this.available(stake, bonded),
        reputation: record.reputation,
        completed: "completed" in record ? record.completed : 0,
        failed: "failed" in record ? record.failed : 0,
        capabilities: "capabilities" in record ? record.capabilities : "",
        attested: record.attested,
        gpu: record.gpu,
        vramGB: record.vramGB,
        benchmarkScore: "benchmarkScore" in record ? record.benchmarkScore : "0",
        models: record.models,
      });
    }
    for (const record of structuredClone(snapshot.offers)) this.offers.set(record.id, record);
    for (const record of structuredClone(snapshot.credits)) this.credits.set(record.id, record);
    if (snapshot.version === 2) {
      for (const record of structuredClone(snapshot.disputes)) this.disputes.set(this.key(record.jobId, record.index), record);
      this.eventHistory.push(...structuredClone(snapshot.eventHistory).slice(-EVENT_HISTORY_CAPACITY));
    }
  }

  static fromSnapshot(snapshot: RestorableProjectionSnapshot): ProjectionStore {
    const store = new ProjectionStore();
    store.restore(snapshot);
    return store;
  }

  private key(jobId: number, index: number): string {
    return `${jobId}:${index}`;
  }

  private normalizeAddress(address: string): string {
    return address.toLowerCase();
  }

  private available(stake: string, bonded: string): string {
    const difference = BigInt(stake) - BigInt(bonded);
    return (difference > 0n ? difference : 0n).toString();
  }

  private updateAvailable(provider: ProviderRecord): void {
    provider.availableStake = this.available(provider.stake, provider.bonded);
  }

  private provider(address: string): ProviderRecord {
    const normalized = this.normalizeAddress(address);
    let p = this.providers.get(normalized);
    if (!p) {
      p = {
        address: normalized,
        registered: false,
        active: false,
        stake: "0",
        bonded: "0",
        availableStake: "0",
        reputation: 5000,
        completed: 0,
        failed: 0,
        capabilities: "",
        attested: false,
        gpu: "",
        vramGB: 0,
        benchmarkScore: "0",
        models: [],
      };
      this.providers.set(normalized, p);
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

  onDisputeOpened(id: number, index: number, provider = "", providerHash = ""): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) t.status = "Disputed";
    this.disputes.set(this.key(id, index), {
      jobId: id,
      index,
      provider: provider ? this.normalizeAddress(provider) : "",
      providerHash,
      status: "Open",
      agreeVotes: 0,
      disagreeVotes: 0,
      votes: [],
      cheatingUpheld: null,
    });
  }

  onChallengeVote(id: number, index: number, challenger: string, agree: boolean): void {
    const dispute = this.disputes.get(this.key(id, index));
    if (!dispute) return;
    dispute.votes.push({ challenger: this.normalizeAddress(challenger), agree });
    if (agree) dispute.agreeVotes += 1;
    else dispute.disagreeVotes += 1;
  }

  onDisputeResolved(id: number, index: number, cheatingUpheld: boolean): void {
    const dispute = this.disputes.get(this.key(id, index));
    if (!dispute) return;
    dispute.status = "Resolved";
    dispute.cheatingUpheld = cheatingUpheld;
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

  listTasks(jobId?: number): TaskRecord[] {
    return [...this.tasks.values()]
      .filter((t) => jobId === undefined || t.jobId === jobId)
      .sort((a, b) => a.jobId - b.jobId || a.index - b.index);
  }

  listDisputes(): DisputeRecord[] {
    return [...this.disputes.values()].sort((a, b) => a.jobId - b.jobId || a.index - b.index);
  }

  recordEvent(event: EventHistoryRecord): void {
    this.eventHistory.push(structuredClone(event));
    this.eventHistory.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    if (this.eventHistory.length > EVENT_HISTORY_CAPACITY) {
      this.eventHistory.splice(0, this.eventHistory.length - EVENT_HISTORY_CAPACITY);
    }
  }

  listEventHistory(type?: string, limit = EVENT_HISTORY_CAPACITY): EventHistoryRecord[] {
    const matching = type ? this.eventHistory.filter((event) => event.name === type) : this.eventHistory;
    return structuredClone(matching.slice(-Math.max(0, limit)));
  }

  // --------------------------------------------------------------------- //
  // Rental market
  // --------------------------------------------------------------------- //

  onListingCreated(
    id: number,
    provider: string,
    pricePerInterval: string,
    intervalSecs: number,
    minIntervals: number,
    maxIntervals: number,
    spec: string
  ): void {
    let gpu = "", region = "", endpoint: string | null = null, models: string[] = [];
    let vramGB = 0;
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
      available: true, activeLeaseId: 0, spec, gpu, vramGB, region, models, endpoint,
    });
    const p = this.provider(provider);
    p.models = Array.from(new Set([...p.models, ...models]));
    if (gpu) p.gpu = gpu;
    if (vramGB) p.vramGB = vramGB;
  }

  onListingAvailabilityChanged(id: number, available: boolean, leaseId: number): void {
    const l = this.listings.get(id);
    if (l) {
      l.available = available;
      l.activeLeaseId = available ? 0 : leaseId;
    }
  }

  onLeaseRequested(
    id: number,
    listingId: number,
    requester: string,
    provider: string,
    fundedIntervals: number,
    escrow: string,
    manifest: string
  ): void {
    const listing = this.listings.get(listingId);
    const pricePerInterval = listing
      ? listing.pricePerInterval
      : fundedIntervals > 0
        ? (BigInt(escrow) / BigInt(fundedIntervals)).toString()
        : "0";
    const intervalSecs = listing ? listing.intervalSecs : 0;
    this.leases.set(id, {
      id, listingId, requester, provider, pricePerInterval, intervalSecs,
      start: 0,
      fundedIntervals,
      maxIntervals: listing?.maxIntervals ?? fundedIntervals,
      heartbeatedIntervals: 0,
      settledIntervals: 0,
      escrow,
      bond: "0",
      lastHeartbeatInterval: null,
      lastHeartbeat: 0,
      status: "Pending",
      manifest,
    });
  }

  onLeaseAccepted(leaseId: number, start: number, bond: string): void {
    const l = this.leases.get(leaseId);
    if (l) {
      l.start = start;
      l.bond = bond;
      l.status = "Active";
    }
  }

  onLeaseRejected(leaseId: number): void {
    const l = this.leases.get(leaseId);
    if (l) {
      l.escrow = "0";
      l.status = "Rejected";
    }
  }

  onLeaseCancelled(leaseId: number): void {
    const l = this.leases.get(leaseId);
    if (l) {
      l.escrow = "0";
      l.status = "Cancelled";
    }
  }

  onHeartbeat(leaseId: number, interval: number, timestamp: number): void {
    const l = this.leases.get(leaseId);
    if (l) {
      l.heartbeatedIntervals = interval + 1;
      l.lastHeartbeatInterval = interval;
      l.lastHeartbeat = timestamp;
    }
  }

  onIntervalSettled(leaseId: number, intervals: number, amount: string): void {
    const l = this.leases.get(leaseId);
    if (l) {
      l.settledIntervals += intervals;
      l.escrow = (BigInt(l.escrow) - BigInt(amount)).toString();
    }
  }

  onLeaseExtended(leaseId: number, addedIntervals: number, addedEscrow: string): void {
    const l = this.leases.get(leaseId);
    if (l) {
      l.fundedIntervals += addedIntervals;
      l.escrow = (BigInt(l.escrow) + BigInt(addedEscrow)).toString();
    }
  }

  onLeaseEnded(leaseId: number): void {
    const l = this.leases.get(leaseId);
    if (l) {
      l.escrow = "0";
      l.status = "Ended";
    }
  }

  onLeaseTerminated(leaseId: number): void {
    const l = this.leases.get(leaseId);
    if (l) {
      l.escrow = "0";
      l.status = "Terminated";
    }
  }

  // --------------------------------------------------------------------- //
  // Provider profile (from registry events)
  // --------------------------------------------------------------------- //

  onProviderRegistered(provider: string, capabilities: string): void {
    const p = this.provider(provider);
    p.registered = true;
    p.active = true;
    p.reputation = 5000;
    p.capabilities = capabilities;
    try {
      const parsed = JSON.parse(capabilities || "{}");
      const gpu = typeof parsed.gpuModel === "string" ? parsed.gpuModel : parsed.gpu;
      const vram = parsed.vramGB ?? parsed.vram;
      const models = Array.isArray(parsed.models)
        ? parsed.models.filter((model: unknown): model is string => typeof model === "string")
        : [];
      if (typeof gpu === "string") p.gpu = gpu;
      if (Number.isFinite(Number(vram))) p.vramGB = Number(vram);
      p.models = Array.from(new Set([...p.models, ...models]));
    } catch {
      // Capabilities are free-form and remain available in their original form.
    }
  }

  onProviderCapabilitiesUpdated(provider: string, capabilities: string): void {
    this.provider(provider).capabilities = capabilities;
  }

  onStaked(provider: string, totalStake: string): void {
    const p = this.provider(provider);
    p.stake = totalStake;
    this.updateAvailable(p);
  }

  onUnstaked(provider: string, totalStake: string): void {
    this.onStaked(provider, totalStake);
  }

  onBonded(provider: string, totalBonded: string): void {
    const p = this.provider(provider);
    p.bonded = totalBonded;
    this.updateAvailable(p);
  }

  onUnbonded(provider: string, totalBonded: string): void {
    this.onBonded(provider, totalBonded);
  }

  onSlashed(provider: string, amount: string): void {
    const p = this.provider(provider);
    const slashed = BigInt(amount);
    const stake = BigInt(p.stake);
    const bonded = BigInt(p.bonded);
    p.stake = (slashed < stake ? stake - slashed : 0n).toString();
    p.bonded = (slashed < bonded ? bonded - slashed : 0n).toString();
    this.updateAvailable(p);
  }

  onActiveSet(provider: string, active: boolean): void {
    this.provider(provider).active = active;
  }

  onAttested(provider: string, gpuModel: string, vramGB: number, benchmarkScore = "0"): void {
    const p = this.provider(provider);
    p.attested = true;
    if (gpuModel) p.gpu = gpuModel;
    if (vramGB) p.vramGB = vramGB;
    p.benchmarkScore = benchmarkScore;
  }

  onReputationUpdated(provider: string, reputation: number, success?: boolean): void {
    const p = this.provider(provider);
    p.reputation = reputation;
    if (success === true) p.completed += 1;
    if (success === false) p.failed += 1;
  }

  // --------------------------------------------------------------------- //
  // Rental getters
  // --------------------------------------------------------------------- //

  listListings(availableOnly = true): ListingRecord[] {
    return [...this.listings.values()]
      .filter((l) => (availableOnly ? l.available : true))
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

  // --------------------------------------------------------------------- //
  // Inference market
  // --------------------------------------------------------------------- //

  onOfferCreated(id: string, provider: string, modelIdentifier: string, pricePerToken: string): void {
    this.offers.set(id, { id, provider, modelIdentifier, pricePerToken, active: true });
    const p = this.provider(provider);
    p.models = Array.from(new Set([...p.models, modelIdentifier]));
  }

  onOfferDeactivated(id: string): void {
    const offer = this.offers.get(id);
    if (offer) offer.active = false;
  }

  onCreditOpened(
    id: string,
    offerId: string,
    requester: string,
    provider: string,
    pricePerToken: string,
    escrow: string
  ): void {
    this.credits.set(id, {
      id,
      offerId,
      requester,
      provider,
      pricePerToken,
      escrow,
      paid: "0",
      promptTokens: "0",
      completionTokens: "0",
      active: true,
    });
  }

  onUsageSettled(
    id: string,
    promptTokens: string,
    completionTokens: string,
    payment: string,
    remainingEscrow: string
  ): void {
    const credit = this.credits.get(id);
    if (credit) {
      credit.promptTokens = promptTokens;
      credit.completionTokens = completionTokens;
      credit.paid = (BigInt(credit.paid) + BigInt(payment)).toString();
      credit.escrow = remainingEscrow;
    }
  }

  onCreditClosed(
    id: string,
    promptTokens: string,
    completionTokens: string,
    totalPaid: string
  ): void {
    const credit = this.credits.get(id);
    if (credit) {
      credit.promptTokens = promptTokens;
      credit.completionTokens = completionTokens;
      credit.paid = totalPaid;
      credit.escrow = "0";
      credit.active = false;
    }
  }

  getOffer(id: string): InferenceOfferRecord | null {
    return this.offers.get(id) ?? null;
  }

  listOffers(): InferenceOfferRecord[] {
    return [...this.offers.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  }

  getCredit(id: string): InferenceCreditRecord | null {
    return this.credits.get(id) ?? null;
  }

  listCredits(requester?: string): InferenceCreditRecord[] {
    const normalized = requester?.toLowerCase();
    return [...this.credits.values()]
      .filter((credit) => !normalized || credit.requester.toLowerCase() === normalized)
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  }

  /** Aggregate models across available listings with the lowest observed price. */
  listModels(): { model: string; minPricePerInterval: string; providers: number }[] {
    const agg = new Map<string, { min: bigint; providers: Set<string> }>();
    for (const l of this.listings.values()) {
      if (!l.available) continue;
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

  /** Find an available listing serving a model, preferring the cheapest with an endpoint. */
  findEndpointForModel(model: string): { listing: ListingRecord } | null {
    const candidates = [...this.listings.values()]
      .filter((l) => l.available && l.endpoint && l.models.includes(model))
      .sort((a, b) => (BigInt(a.pricePerInterval) < BigInt(b.pricePerInterval) ? -1 : 1));
    return candidates.length ? { listing: candidates[0] } : null;
  }

  /** Resolve network metadata only for the provider and model bound to a credit. */
  findEndpointForProviderModel(provider: string, model: string): { listing: ListingRecord } | null {
    const normalized = provider.toLowerCase();
    const candidates = [...this.listings.values()]
      .filter((listing) =>
        listing.provider.toLowerCase() === normalized
        && listing.endpoint
        && listing.models.includes(model)
      )
      .sort((a, b) => Number(b.available) - Number(a.available) || a.id - b.id);
    return candidates.length ? { listing: candidates[0] } : null;
  }
}
