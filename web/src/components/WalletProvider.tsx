"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPublicClient, http, getAddress } from "viem";
import { ORCHESTRATOR_URL, RPC_URL } from "@/lib/config";
import { erc20Abi } from "@/lib/erc20";
import type { Deployment } from "@/lib/types";

interface WalletState {
  address: string | null;
  balanceWei: bigint;
  connecting: boolean;
  connect: () => Promise<void>;
}

const WalletContext = createContext<WalletState>({
  address: null,
  balanceWei: 0n,
  connecting: false,
  connect: async () => {},
});

export const useWallet = () => useContext(WalletContext);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [balanceWei, setBalanceWei] = useState<bigint>(0n);
  const [connecting, setConnecting] = useState(false);
  const [tokenAddr, setTokenAddr] = useState<string | null>(null);

  const publicClient = useMemo(() => createPublicClient({ transport: http(RPC_URL) }), []);

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

  async function refreshBalance(addr: string, token: string) {
    try {
      const bal = await publicClient.readContract({
        address: getAddress(token),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [getAddress(addr)],
      });
      setBalanceWei(bal as bigint);
    } catch {
      setBalanceWei(0n);
    }
  }

  async function connect() {
    const eth = (globalThis as unknown as { ethereum?: { request: (a: unknown) => Promise<string[]> } }).ethereum;
    if (!eth) {
      alert("No wallet found. Install a browser wallet such as MetaMask.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      const a = accounts?.[0] ?? null;
      setAddress(a);
      if (a && tokenAddr) await refreshBalance(a, tokenAddr);
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    if (!address || !tokenAddr) return;
    refreshBalance(address, tokenAddr);
    const id = setInterval(() => refreshBalance(address, tokenAddr), 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tokenAddr]);

  return (
    <WalletContext.Provider value={{ address, balanceWei, connecting, connect }}>
      {children}
    </WalletContext.Provider>
  );
}
