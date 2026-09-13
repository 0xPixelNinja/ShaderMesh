import "dotenv/config";

export interface Config {
  rpcUrl: string;
  deploymentsFile: string;
  storageBackend: "local" | "ipfs";
  storageRoot: string;
  ipfsApiUrl: string;
  port: number;
}

export function loadConfig(): Config {
  return {
    rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
    deploymentsFile:
      process.env.DEPLOYMENTS_FILE ?? "../contracts/deployments/docker.json",
    storageBackend: (process.env.STORAGE_BACKEND as "local" | "ipfs") ?? "ipfs",
    storageRoot: process.env.STORAGE_ROOT ?? "./data",
    ipfsApiUrl: process.env.IPFS_API_URL ?? "http://127.0.0.1:5001",
    port: Number(process.env.PORT ?? 4000),
  };
}
