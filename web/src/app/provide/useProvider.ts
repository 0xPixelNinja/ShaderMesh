"use client";

import { useEffect, useState } from "react";
import { createPublicClient, getAddress, http, parseUnits, parseEther, type Hash } from "viem";
import { useApi } from "@/lib/api";
import { RPC_URL } from "@/lib/config";
import { waitForTransaction } from "@/lib/actions";
import { useWallet } from "@/components/WalletProvider";
import type { Challenge, Deployment, InferenceCredit, InferenceOffer, Lease, Listing, Provider } from "@/lib/types";

/** Deploy script default, used when the registry cannot be read. */
export const DEFAULT_MIN_STAKE = parseEther("50");

const publicClient = createPublicClient({ transport: http(RPC_URL) });
const minStakeAbi = [
  { type: "function", name: "minStake", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

export function asBigInt(value: string | number | bigint | null | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

export function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseAmount(value: string, label: string): bigint {
  let parsed: bigint;
  try {
    parsed = parseUnits(value.trim(), 18);
  } catch {
    throw new Error(`Enter a valid ${label} amount.`);
  }
  if (parsed <= 0n) throw new Error(`${label[0].toUpperCase()}${label.slice(1)} must be greater than zero.`);
  return parsed;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

/** Read the registry's minimum stake once the deployment is known. */
function useMinStake(registry: string | undefined): { value: bigint; known: boolean } {
  const [value, setValue] = useState<bigint | null>(null);
  useEffect(() => {
    if (!registry) return;
    let alive = true;
    publicClient
      .readContract({ address: getAddress(registry), abi: minStakeAbi, functionName: "minStake" })
      .then((v) => alive && setValue(v))
      .catch(() => alive && setValue(null));
    return () => {
      alive = false;
    };
  }, [registry]);
  return { value: value ?? DEFAULT_MIN_STAKE, known: value !== null };
}

/** Everything the provider workspace knows about the connected wallet's node. */
export function useProvider() {
  const wallet = useWallet();
  const { address } = wallet;
  const providersState = useApi<Provider[]>("/providers", 3000);
  const listingsState = useApi<Listing[]>("/listings?all=true", 3000);
  const offersState = useApi<InferenceOffer[]>("/offers", 3000);
  const leasesState = useApi<Lease[]>("/leases", 5000);
  const creditsState = useApi<InferenceCredit[]>("/credits", 5000);
  const deploymentState = useApi<Deployment>("/deployment", 30000);
  const challengesState = useApi<Challenge[]>(`/challenges?provider=${address ?? "none"}`, 5000);

  const deployment = deploymentState.data?.contracts;
  const chainId = deploymentState.data?.chainId;
  const minStake = useMinStake(deployment?.ProviderRegistry);

  const key = address?.toLowerCase() ?? "";
  const mine = <T extends { provider: string }>(rows: T[] | null) =>
    (rows ?? []).filter((row) => row.provider.toLowerCase() === key);

  const providers = providersState.data ?? [];
  const provider = providers.find((p) => p.address.toLowerCase() === key);
  const listings = mine(listingsState.data);
  const offers = mine(offersState.data);
  // Requests needing attention sort first, then newest.
  const order: Record<string, number> = { Pending: 0, Active: 1 };
  const leases = mine(leasesState.data).sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || b.id - a.id);
  const challenges = challengesState.data ?? [];

  const stake = asBigInt(provider?.stake);
  const bonded = asBigInt(provider?.bonded);
  const free = asBigInt(provider?.availableStake);
  const rentalEarnings = leases.reduce((t, l) => t + asBigInt(l.pricePerInterval) * BigInt(l.settledIntervals), 0n);
  const inferenceEarnings = mine(creditsState.data).reduce((t, c) => t + asBigInt(c.paid), 0n);

  const registered = Boolean(provider?.registered);
  const active = Boolean(provider?.active);
  const staked = registered && stake >= minStake.value;
  const attested = Boolean(provider?.attested);
  const published = listings.length > 0 || offers.length > 0;
  const lastStatus = provider?.lastChallenge?.status;
  const challengeOpen = lastStatus === "open" || lastStatus === "responded";

  /** Why market actions are disabled, or null when the node may publish. */
  const blocker = !address
    ? "Connect a wallet to publish capacity."
    : !registered
      ? "Register a hardware profile first."
      : !staked
        ? "Stake at least the minimum before publishing."
        : !attested
          ? "Waiting for the operator to attest your hardware."
          : !active
            ? "Set the node active on the Node page before publishing."
            : null;

  return {
    wallet,
    address,
    deployment,
    chainId,
    isTestNetwork: chainId === 31337 || chainId === 11155111,
    minStake,
    providers,
    provider,
    listings,
    offers,
    leases,
    challenges,
    stake,
    bonded,
    free,
    rentalEarnings,
    inferenceEarnings,
    registered,
    active,
    staked,
    attested,
    published,
    challengeOpen,
    blocker,
    loading: providersState.loading,
    states: { providersState, listingsState, offersState, leasesState, creditsState, deploymentState, challengesState },
    apiError: providersState.error ?? listingsState.error ?? offersState.error ?? deploymentState.error,
  };
}

export type ProviderData = ReturnType<typeof useProvider>;

export interface TxNoticeState {
  text: string;
  error?: boolean;
  hash?: string;
}

/** One transaction at a time per page, with progress text for a live region. */
export function useTransactions() {
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<TxNoticeState | null>(null);

  /** Run one or more wallet writes in order, waiting for each confirmation. */
  async function run(key: string, steps: { prompt: string; write: () => Promise<Hash> }[], done = "Transaction confirmed. Indexed data will refresh shortly.") {
    setPending(key);
    try {
      for (const step of steps) {
        setNotice({ text: step.prompt });
        const hash = await step.write();
        setNotice({ text: "Transaction submitted. Waiting for confirmation.", hash });
        await waitForTransaction(hash);
      }
      setNotice((n) => ({ text: done, hash: n?.hash }));
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setPending(null);
    }
  }

  function fail(error: unknown) {
    setNotice({ text: error instanceof Error ? error.message : String(error), error: true });
  }

  return { pending, notice, run, fail };
}
