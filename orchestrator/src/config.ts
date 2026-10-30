import "dotenv/config";

export interface Config {
  databaseUrl: string;
  rpcUrl: string;
  deploymentsFile: string;
  storageBackend: "local" | "ipfs";
  storageRoot: string;
  ipfsApiUrl: string;
  port: number;
  requestBodyLimitBytes: number;
  providerFetchTimeoutMs: number;
  providerHostAllowlist: string[];
  leaseSshHost?: string;
  indexerBlockRange: number;
  indexerPollIntervalMs: number;
  indexerRpcRetryAttempts: number;
  indexerRpcRetryIntervalMs: number;
}

export function loadConfig(): Config {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return {
    databaseUrl: process.env.DATABASE_URL,
    rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
    deploymentsFile:
      process.env.DEPLOYMENTS_FILE ?? "../contracts/deployments/docker.json",
    storageBackend: (process.env.STORAGE_BACKEND as "local" | "ipfs") ?? "ipfs",
    storageRoot: process.env.STORAGE_ROOT ?? "./data",
    ipfsApiUrl: process.env.IPFS_API_URL ?? "http://127.0.0.1:5001",
    port: Number(process.env.PORT ?? 4000),
    requestBodyLimitBytes: Number(process.env.REQUEST_BODY_LIMIT_BYTES ?? 1_048_576),
    providerFetchTimeoutMs: Number(process.env.PROVIDER_FETCH_TIMEOUT_MS ?? 30_000),
    leaseSshHost: process.env.LEASE_SSH_PUBLIC_HOST?.trim() || undefined,
    providerHostAllowlist: (process.env.PROVIDER_HOST_ALLOWLIST ?? "provider")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    indexerBlockRange: Number(process.env.INDEXER_BLOCK_RANGE ?? 2_000),
    indexerPollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 4_000),
    indexerRpcRetryAttempts: Number(process.env.INDEXER_RPC_RETRY_ATTEMPTS ?? 3),
    indexerRpcRetryIntervalMs: Number(process.env.INDEXER_RPC_RETRY_INTERVAL_MS ?? 1_000),
  };
}
