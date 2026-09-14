"use client";

import { createWalletClient, custom, getAddress } from "viem";
import { shaderChain } from "./chain";

const rentalAbi = [
  {
    type: "function",
    name: "openLease",
    stateMutability: "nonpayable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "intervals", type: "uint32" },
    ],
    outputs: [{ name: "leaseId", type: "uint256" }],
  },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "leaseId", type: "uint256" }], outputs: [] },
  { type: "function", name: "endLease", stateMutability: "nonpayable", inputs: [{ name: "leaseId", type: "uint256" }], outputs: [] },
] as const;

const approveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function walletClient() {
  const eth = (globalThis as unknown as { ethereum?: any }).ethereum;
  if (!eth) throw new Error("No wallet found");
  return createWalletClient({ chain: shaderChain, transport: custom(eth) });
}

/**
 * Rent a GPU: approve escrow to the RentalMarket, then open the lease.
 * Both transactions are signed by the user's wallet; no funds are custodied off chain.
 */
export async function rentGpu(params: {
  account: string;
  token: string;
  rental: string;
  listingId: number;
  pricePerInterval: string;
  intervals: number;
}): Promise<string> {
  const client = walletClient();
  const account = getAddress(params.account);
  const escrow = BigInt(params.pricePerInterval) * BigInt(params.intervals);

  await client.writeContract({
    account,
    address: getAddress(params.token),
    abi: approveAbi,
    functionName: "approve",
    args: [getAddress(params.rental), escrow],
  });

  const hash = await client.writeContract({
    account,
    address: getAddress(params.rental),
    abi: rentalAbi,
    functionName: "openLease",
    args: [BigInt(params.listingId), params.intervals],
  });

  return hash;
}

export async function settleLease(account: string, rental: string, leaseId: number): Promise<string> {
  return walletClient().writeContract({
    account: getAddress(account),
    address: getAddress(rental),
    abi: rentalAbi,
    functionName: "settle",
    args: [BigInt(leaseId)],
  });
}

export async function endLease(account: string, rental: string, leaseId: number): Promise<string> {
  return walletClient().writeContract({
    account: getAddress(account),
    address: getAddress(rental),
    abi: rentalAbi,
    functionName: "endLease",
    args: [BigInt(leaseId)],
  });
}
