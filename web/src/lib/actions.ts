"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  keccak256,
  toBytes,
  type Hash,
} from "viem";
import { shaderChain } from "./chain";
import { RPC_URL } from "./config";
import { getEthereumProvider } from "./ethereum";

const rentalAbi = [
  {
    type: "function",
    name: "createListing",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pricePerInterval", type: "uint256" },
      { name: "intervalSecs", type: "uint64" },
      { name: "minIntervals", type: "uint32" },
      { name: "maxIntervals", type: "uint32" },
      { name: "spec", type: "string" },
    ],
    outputs: [{ name: "listingId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setListingAvailable",
    stateMutability: "nonpayable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "available", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestLease",
    stateMutability: "nonpayable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "intervals", type: "uint32" },
      { name: "manifest", type: "string" },
    ],
    outputs: [{ name: "leaseId", type: "uint256" }],
  },
  { type: "function", name: "cancelLease", stateMutability: "nonpayable", inputs: [{ name: "leaseId", type: "uint256" }], outputs: [] },
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

const inferenceAbi = [
  {
    type: "function",
    name: "createOffer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "modelIdentifier", type: "string" },
      { name: "pricePerToken", type: "uint256" },
    ],
    outputs: [{ name: "offerId", type: "uint256" }],
  },
  {
    type: "function",
    name: "deactivateOffer",
    stateMutability: "nonpayable",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "openCredit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "offerId", type: "uint256" },
      { name: "escrow", type: "uint256" },
    ],
    outputs: [{ name: "creditId", type: "uint256" }],
  },
  {
    type: "function",
    name: "settleUsage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "creditId", type: "uint256" },
      { name: "cumulativePromptTokens", type: "uint256" },
      { name: "cumulativeCompletionTokens", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "closeCredit",
    stateMutability: "nonpayable",
    inputs: [{ name: "creditId", type: "uint256" }],
    outputs: [],
  },
] as const;

const tokenAbi = [
  { type: "function", name: "faucet", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

const registryAbi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "capabilities", type: "string" }], outputs: [] },
  { type: "function", name: "updateCapabilities", stateMutability: "nonpayable", inputs: [{ name: "capabilities", type: "string" }], outputs: [] },
  { type: "function", name: "setActive", stateMutability: "nonpayable", inputs: [{ name: "active", type: "bool" }], outputs: [] },
  { type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "unstake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

/**
 * Point the wallet at the deployment's chain before writing.
 *
 * The dashboard reads state straight from the RPC, so a wallet left on another
 * network still renders correct balances and only fails at signing time. Switch
 * it up front, adding the network first when the wallet does not know it yet.
 */
async function ensureChain(eth: NonNullable<ReturnType<typeof getEthereumProvider>>) {
  const current = await eth.request({ method: "eth_chainId" });
  const target = `0x${shaderChain.id.toString(16)}`;
  if (typeof current === "string" && current.toLowerCase() === target) return;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target as `0x${string}` }],
    });
  } catch (error) {
    // 4902 means the wallet has no such network configured yet.
    const code = (error as { code?: number })?.code;
    if (code !== 4902) throw error;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: target,
        chainName: shaderChain.name,
        rpcUrls: shaderChain.rpcUrls.default.http,
        nativeCurrency: shaderChain.nativeCurrency,
      }],
    } as never);
  }
}

async function walletClient() {
  const eth = getEthereumProvider();
  if (!eth) throw new Error("No wallet found");
  await ensureChain(eth);
  return createWalletClient({ chain: shaderChain, transport: custom(eth) });
}

const publicClient = createPublicClient({ chain: shaderChain, transport: http(RPC_URL) });

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Messages contain an unsupported value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export interface InferenceAuthorization {
  creditId: string;
  requestId: string;
  requester: string;
  provider: string;
  model: string;
  expiry: number;
}

/** Match the orchestrator's byte-for-byte EIP-191 authorization payload. */
export function canonicalInferenceAuthorization(
  authorization: InferenceAuthorization,
  messages: unknown,
): string {
  const payload = {
    creditId: BigInt(authorization.creditId).toString(),
    expiry: authorization.expiry,
    messagesHash: keccak256(toBytes(canonicalJson(messages))),
    model: authorization.model,
    provider: getAddress(authorization.provider).toLowerCase(),
    requestId: authorization.requestId,
    requester: getAddress(authorization.requester).toLowerCase(),
  };
  return `ShaderMesh Inference Authorization v1\n${JSON.stringify(payload)}`;
}

export async function signInferenceAuthorization(
  authorization: InferenceAuthorization,
  messages: unknown,
): Promise<Hash> {
  const account = getAddress(authorization.requester);
  return (await walletClient()).signMessage({
    account,
    message: canonicalInferenceAuthorization(authorization, messages),
  });
}

export async function waitForTransaction(hash: Hash): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
}

export async function claimFaucet(account: string, token: string): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(token),
    abi: tokenAbi,
    functionName: "faucet",
  });
}

export async function registerProvider(account: string, registry: string, capabilities: string): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(registry),
    abi: registryAbi,
    functionName: "register",
    args: [capabilities],
  });
}

export async function updateProviderCapabilities(account: string, registry: string, capabilities: string): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(registry),
    abi: registryAbi,
    functionName: "updateCapabilities",
    args: [capabilities],
  });
}

export async function setProviderActive(account: string, registry: string, active: boolean): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(registry),
    abi: registryAbi,
    functionName: "setActive",
    args: [active],
  });
}

export async function approveProviderStake(account: string, token: string, registry: string, amount: bigint): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(token),
    abi: approveAbi,
    functionName: "approve",
    args: [getAddress(registry), amount],
  });
}

export async function stakeProvider(account: string, registry: string, amount: bigint): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(registry),
    abi: registryAbi,
    functionName: "stake",
    args: [amount],
  });
}

export async function unstakeProvider(account: string, registry: string, amount: bigint): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(registry),
    abi: registryAbi,
    functionName: "unstake",
    args: [amount],
  });
}

export async function createRentalListing(params: {
  account: string;
  rental: string;
  pricePerInterval: bigint;
  intervalSecs: number;
  minIntervals: number;
  maxIntervals: number;
  spec: string;
}): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(params.account),
    address: getAddress(params.rental),
    abi: rentalAbi,
    functionName: "createListing",
    args: [
      params.pricePerInterval,
      BigInt(params.intervalSecs),
      params.minIntervals,
      params.maxIntervals,
      params.spec,
    ],
  });
}

export async function setRentalListingAvailable(account: string, rental: string, listingId: number, available: boolean): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(rental),
    abi: rentalAbi,
    functionName: "setListingAvailable",
    args: [BigInt(listingId), available],
  });
}

export async function createInferenceOffer(account: string, inferenceMarket: string, model: string, pricePerToken: bigint): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(inferenceMarket),
    abi: inferenceAbi,
    functionName: "createOffer",
    args: [model, pricePerToken],
  });
}

export async function deactivateInferenceOffer(account: string, inferenceMarket: string, offerId: string): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(inferenceMarket),
    abi: inferenceAbi,
    functionName: "deactivateOffer",
    args: [BigInt(offerId)],
  });
}

export async function approveInferenceCredit(
  account: string,
  token: string,
  inferenceMarket: string,
  amount: bigint,
): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(token),
    abi: approveAbi,
    functionName: "approve",
    args: [getAddress(inferenceMarket), amount],
  });
}

export async function openInferenceCredit(
  account: string,
  inferenceMarket: string,
  offerId: string,
  escrow: bigint,
): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(inferenceMarket),
    abi: inferenceAbi,
    functionName: "openCredit",
    args: [BigInt(offerId), escrow],
  });
}

export async function settleInferenceUsage(
  account: string,
  inferenceMarket: string,
  creditId: string,
  cumulativePromptTokens: bigint,
  cumulativeCompletionTokens: bigint,
): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(inferenceMarket),
    abi: inferenceAbi,
    functionName: "settleUsage",
    args: [BigInt(creditId), cumulativePromptTokens, cumulativeCompletionTokens],
  });
}

export async function closeInferenceCredit(
  account: string,
  inferenceMarket: string,
  creditId: string,
): Promise<Hash> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(inferenceMarket),
    abi: inferenceAbi,
    functionName: "closeCredit",
    args: [BigInt(creditId)],
  });
}

/**
 * Request a GPU lease: approve escrow to the RentalMarket, then submit the request.
 * Both transactions are signed by the user's wallet; no funds are custodied off chain.
 */
export async function requestLease(params: {
  account: string;
  token: string;
  rental: string;
  listingId: number;
  pricePerInterval: string;
  intervals: number;
  manifest: string;
}): Promise<string> {
  const client = await walletClient();
  const account = getAddress(params.account);
  const escrow = BigInt(params.pricePerInterval) * BigInt(params.intervals);

  const approvalHash = await client.writeContract({
    account,
    address: getAddress(params.token),
    abi: approveAbi,
    functionName: "approve",
    args: [getAddress(params.rental), escrow],
  });
  await waitForTransaction(approvalHash);

  const hash = await client.writeContract({
    account,
    address: getAddress(params.rental),
    abi: rentalAbi,
    functionName: "requestLease",
    args: [BigInt(params.listingId), params.intervals, params.manifest],
  });

  return hash;
}

export async function cancelLease(account: string, rental: string, leaseId: number): Promise<string> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(rental),
    abi: rentalAbi,
    functionName: "cancelLease",
    args: [BigInt(leaseId)],
  });
}

export async function settleLease(account: string, rental: string, leaseId: number): Promise<string> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(rental),
    abi: rentalAbi,
    functionName: "settle",
    args: [BigInt(leaseId)],
  });
}

export async function endLease(account: string, rental: string, leaseId: number): Promise<string> {
  return (await walletClient()).writeContract({
    account: getAddress(account),
    address: getAddress(rental),
    abi: rentalAbi,
    functionName: "endLease",
    args: [BigInt(leaseId)],
  });
}
