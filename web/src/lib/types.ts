export interface Listing {
  id: number;
  provider: string;
  pricePerInterval: string;
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
  endpoint: string | null;
}

export type LeaseStatus = "Pending" | "Active" | "Ended" | "Terminated" | "Rejected" | "Cancelled";

export interface Lease {
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

export interface Provider {
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
  challengesPassed?: number;
  challengesFailed?: number;
  lastChallenge?: { id: number; status: ChallengeStatus } | null;
}

export type ChallengeStatus = "open" | "responded" | "passed" | "failed" | "lapsed";

export interface ChainRef {
  blockNumber: number;
  transactionHash: string;
  timestamp: number | null;
}

export interface Challenge {
  id: number;
  provider: string;
  seed: string;
  issuedAt: number | null;
  deadline: number;
  status: ChallengeStatus;
  score: string | null;
  outputHash: string | null;
  slashed: string;
  issued: ChainRef | null;
  responded: ChainRef | null;
  resolved: ChainRef | null;
}

export type TaskStatus = "Open" | "Claimed" | "Submitted" | "Disputed" | "Paid";

export interface Task {
  jobId: number;
  index: number;
  provider: string | null;
  status: TaskStatus;
  resultHash: string | null;
  outputCID: string | null;
}

export interface Job {
  id: number;
  requester: string;
  inputCID: string;
  taskCount: number;
  rewardPerTask: string;
  completedTasks: number;
  completed: boolean;
  resultCID: string | null;
}

export interface ChallengeVote {
  challenger: string;
  agree: boolean;
}

export interface Dispute {
  jobId: number;
  index: number;
  provider: string;
  providerHash: string;
  status: "Open" | "Resolved";
  agreeVotes: number;
  disagreeVotes: number;
  votes: ChallengeVote[];
  cheatingUpheld: boolean | null;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ChainEvent {
  name: string;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  payload: Record<string, JsonValue>;
}

export interface ModelInfo {
  model: string;
  minPricePerInterval: string;
  providers: number;
}

export interface InferenceOffer {
  id: string;
  provider: string;
  modelIdentifier: string;
  pricePerToken: string;
  active: boolean;
}

export interface InferenceCredit {
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

export interface LeaseAccess {
  leaseId: number;
  protocol: string;
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface Deployment {
  chainId: number;
  contracts: Record<string, string>;
}
