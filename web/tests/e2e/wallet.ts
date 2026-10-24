import type { Page } from "@playwright/test";
import { decodeFunctionResult, encodeFunctionData, parseAbi, parseUnits } from "viem";

export const RPC_URL = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8545";
export const ORCHESTRATOR_URL = process.env.E2E_ORCHESTRATOR_URL ?? "http://127.0.0.1:4000";
export const CHAIN_ID_HEX = "0x7a69";

export interface Deployment {
  contracts: Record<
    "SmeshToken" | "ProviderRegistry" | "RentalMarket" | "InferenceMarket",
    string
  >;
}

export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await response.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

export async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${ORCHESTRATOR_URL}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const getDeployment = () => api<Deployment>("/deployment");

/** Unlocked hardhat account by index, so the node can sign for it. */
export async function hardhatAccount(index: number): Promise<string> {
  const accounts = await rpc<string[]>("eth_accounts");
  return accounts[index];
}

/** Send a transaction from an account the node controls and wait for its receipt. */
export async function sendTx(from: string, to: string, data: `0x${string}`): Promise<void> {
  const hash = await rpc<string>("eth_sendTransaction", [{ from, to, data }]);
  for (let attempt = 0; attempt < 60; attempt++) {
    const receipt = await rpc<{ status: string } | null>("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error(`transaction ${hash} reverted`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`transaction ${hash} was not mined in time`);
}

const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const rentalAbi = parseAbi([
  "function endLease(uint256 leaseId)",
  "function cancelLease(uint256 leaseId)",
]);

export async function smeshBalance(address: string): Promise<bigint> {
  const { contracts } = await getDeployment();
  const result = await rpc<`0x${string}`>("eth_call", [
    {
      to: contracts.SmeshToken,
      data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [address as `0x${string}`] }),
    },
    "latest",
  ]);
  return decodeFunctionResult({ abi: tokenAbi, functionName: "balanceOf", data: result });
}

/** Top an account up to at least `minimum` SMESH from the deployer (account 0). */
export async function ensureSmesh(address: string, minimum: string): Promise<void> {
  const target = parseUnits(minimum, 18);
  const current = await smeshBalance(address);
  if (current >= target) return;
  const { contracts } = await getDeployment();
  await sendTx(
    await hardhatAccount(0),
    contracts.SmeshToken,
    encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [address as `0x${string}`, target - current] }),
  );
}

interface ApiListing {
  id: number;
  available: boolean;
  activeLeaseId: number;
}
interface ApiLease {
  id: number;
  requester: string;
  status: string;
}

/**
 * Make sure at least one rental listing can be leased. If every listing is
 * reserved by a lease from another account, release it the way its owner
 * would: cancel a pending lease or end an active one. The requesters are
 * hardhat accounts, so the node signs for them.
 */
export async function ensureAvailableListing(): Promise<void> {
  const { contracts } = await getDeployment();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const listings = await api<ApiListing[]>("/listings?all=true");
    if (listings.some((listing) => listing.available)) return;

    const leases = await api<ApiLease[]>("/leases");
    for (const listing of listings) {
      const lease = leases.find((entry) => entry.id === listing.activeLeaseId);
      if (!lease) continue;
      const functionName = lease.status === "Pending" ? "cancelLease" : "endLease";
      try {
        await sendTx(
          lease.requester,
          contracts.RentalMarket,
          encodeFunctionData({ abi: rentalAbi, functionName, args: [BigInt(lease.id)] }),
        );
      } catch {
        // The lease may have changed state between the read and the write; poll again.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("no rental listing became available");
}

/**
 * Inject a minimal EIP-1193 provider as window.ethereum before the app loads.
 *
 * Reads and writes are forwarded to the local node, which controls the chosen
 * account, so eth_sendTransaction and personal_sign are signed by the node.
 * Like a real wallet, eth_accounts stays empty until the page has called
 * eth_requestAccounts, and the grant survives reloads within the tab.
 */
export async function installWallet(page: Page, account: string): Promise<void> {
  await page.addInitScript(
    ({ account, rpcUrl, chainId }) => {
      const GRANT_KEY = "e2e:wallet-granted";
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const granted = () => {
        try {
          return sessionStorage.getItem(GRANT_KEY) === "1";
        } catch {
          return false;
        }
      };
      const setGranted = (value: boolean) => {
        try {
          if (value) sessionStorage.setItem(GRANT_KEY, "1");
          else sessionStorage.removeItem(GRANT_KEY);
        } catch {
          // storage unavailable; the grant lasts for this page only
        }
      };
      const emit = (event: string, ...args: unknown[]) =>
        listeners.get(event)?.forEach((listener) => listener(...args));

      async function forward(method: string, params: unknown[]) {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        });
        const json = await response.json();
        if (json.error) {
          const error = new Error(json.error.message) as Error & { code?: number; data?: unknown };
          error.code = json.error.code;
          error.data = json.error.data;
          throw error;
        }
        return json.result;
      }

      const provider = {
        isMetaMask: false,
        isE2EWallet: true,
        async request({ method, params = [] }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
              setGranted(true);
              emit("accountsChanged", [account]);
              return [account];
            case "eth_accounts":
              return granted() ? [account] : [];
            case "eth_chainId":
              return chainId;
            case "net_version":
              return String(parseInt(chainId, 16));
            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              return null;
            case "wallet_revokePermissions":
              setGranted(false);
              emit("accountsChanged", []);
              return null;
            default:
              return forward(method, params);
          }
        },
        on(event: string, listener: (...args: unknown[]) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(listener);
          return provider;
        },
        removeListener(event: string, listener: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(listener);
          return provider;
        },
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    },
    { account, rpcUrl: RPC_URL, chainId: CHAIN_ID_HEX },
  );
}
