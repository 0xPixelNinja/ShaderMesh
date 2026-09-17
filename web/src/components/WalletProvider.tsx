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
}

const WalletContext = createContext<WalletState>({
  address: null,
  balanceWei: 0n,
  connecting: false,
  connect: async () => {},
});

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
      setAddress(a);
      if (a && tokenAddr) setBalanceWei(await readBalance(a, tokenAddr));
    } finally {
      setConnecting(false);
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
    <WalletContext.Provider value={{ address, balanceWei, connecting, connect }}>
      {children}
    </WalletContext.Provider>
  );
}
