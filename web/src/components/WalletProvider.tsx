"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPublicClient, http, getAddress } from "viem";
import { ORCHESTRATOR_URL, RPC_URL } from "@/lib/config";
import { erc20Abi } from "@/lib/erc20";
import { getEthereumProvider } from "@/lib/ethereum";
import type { Deployment } from "@/lib/types";

interface WalletState {
  address: string | null;
  balanceWei: bigint;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletState>({
  address: null,
  balanceWei: 0n,
  connecting: false,
  connect: async () => {},
  disconnect: async () => {},
});

// A wallet keeps its approval after the app "disconnects", so remember the
// intent for this tab and stop restoring the session on reload.
const DISCONNECTED_KEY = "shadermesh:wallet-disconnected";

export const useWallet = () => useContext(WalletContext);

const publicClient = createPublicClient({ transport: http(RPC_URL) });

async function readBalance(address: string, token: string): Promise<bigint> {
  try {
    return await publicClient.readContract({
      address: getAddress(token),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [getAddress(address)],
    });
  } catch {
    return 0n;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [balanceWei, setBalanceWei] = useState<bigint>(0n);
  const [connecting, setConnecting] = useState(false);
  const [tokenAddr, setTokenAddr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${ORCHESTRATOR_URL}/deployment`);
        const dep = (await res.json()) as Deployment;
        setTokenAddr(dep?.contracts?.SmeshToken ?? null);
      } catch {
        // orchestrator not up yet; balance stays zero until it is
      }
    })();
  }, []);

  // Restore an already-authorized account on load. eth_accounts does not prompt,
  // so a page refresh keeps the session instead of forcing a reconnect.
  useEffect(() => {
    const eth = getEthereumProvider();
    if (!eth) return;

    let cancelled = false;
    (async () => {
      if (sessionStorage.getItem(DISCONNECTED_KEY) === "1") return;
      try {
        const accounts = await eth.request({ method: "eth_accounts" });
        if (!cancelled && accounts?.[0]) setAddress(accounts[0]);
      } catch {
        // no authorized account; the user connects explicitly
      }
    })();

    const onAccountsChanged = (accounts: string[]) => {
      setAddress(accounts?.[0] ?? null);
      if (!accounts?.[0]) setBalanceWei(0n);
    };
    // A network switch invalidates balances read from the previous chain.
    const onChainChanged = () => window.location.reload();

    eth.on?.("accountsChanged", onAccountsChanged);
    eth.on?.("chainChanged", onChainChanged);
    return () => {
      cancelled = true;
      eth.removeListener?.("accountsChanged", onAccountsChanged);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  async function connect() {
    const eth = getEthereumProvider();
    if (!eth) {
      alert("No wallet found. Install a browser wallet such as MetaMask.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      const a = accounts?.[0] ?? null;
      sessionStorage.removeItem(DISCONNECTED_KEY);
      setAddress(a);
      if (a && tokenAddr) setBalanceWei(await readBalance(a, tokenAddr));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    sessionStorage.setItem(DISCONNECTED_KEY, "1");
    setAddress(null);
    setBalanceWei(0n);

    // Best effort: ask the wallet to drop the account permission entirely so a
    // reconnect prompts again. Not every wallet implements this.
    const eth = getEthereumProvider();
    try {
      await eth?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      } as never);
    } catch {
      // wallet does not support revocation; the session flag still applies
    }
  }

  useEffect(() => {
    if (!address || !tokenAddr) return;
    let cancelled = false;
    const refresh = async () => {
      const balance = await readBalance(address, tokenAddr);
      if (!cancelled) setBalanceWei(balance);
    };
    void refresh();
    const id = setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address, tokenAddr]);

  return (
    <WalletContext.Provider value={{ address, balanceWei, connecting, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}
