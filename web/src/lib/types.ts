export interface Listing {
  id: number;
  provider: string;
  pricePerInterval: string;
  intervalSecs: number;
  minIntervals: number;
  maxIntervals: number;
  active: boolean;
  gpu: string;
  vramGB: number;
  region: string;
  models: string[];
  endpoint: string | null;
}

export type LeaseStatus = "Active" | "Ended" | "Terminated";

export interface Lease {
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

export interface Provider {
  address: string;
  reputation: number;
  attested: boolean;
  gpu: string;
  vramGB: number;
  models: string[];
}

export interface ModelInfo {
  model: string;
  minPricePerInterval: string;
  providers: number;
}

export interface Deployment {
  chainId: number;
  contracts: Record<string, string>;
}
