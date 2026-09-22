"use client";

import { useState } from "react";
import { parseUnits, type Hash } from "viem";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { Card, CardHead, CopyValue, Empty, RepBar, StatusTag } from "@/components/ui";
import {
  approveProviderStake,
  claimFaucet,
  createInferenceOffer,
  createRentalListing,
  deactivateInferenceOffer,
  registerProvider,
  setProviderActive,
  setRentalListingAvailable,
  stakeProvider,
  unstakeProvider,
  updateProviderCapabilities,
  waitForTransaction,
} from "@/lib/actions";
import { fmtInterval, fmtSmesh, repScore } from "@/lib/format";
import type { Deployment, InferenceCredit, InferenceOffer, Lease, Listing, Provider } from "@/lib/types";

const DEFAULT_CAPABILITIES = JSON.stringify({
  gpuModel: "NVIDIA GeForce RTX 4070 Laptop GPU",
  vramGB: 8,
  cpu: "host",
  models: ["gemma3:4b", "qwen3:0.6b"],
}, null, 2);

const DEFAULT_SPEC = JSON.stringify({
  gpu: "RTX 4070 Laptop GPU",
  vram: 8,
  region: "local",
  models: ["gemma3:4b", "qwen3:0.6b"],
  endpoint: "http://provider:8100",
}, null, 2);

const inputClass = "w-full rounded-md border border-line bg-bg px-3 py-2 text-[13px] text-ink transition-colors duration-fast ease-out placeholder:text-faint hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "inline-flex h-9 items-center justify-center rounded-md border border-accent bg-accent px-3.5 text-[13px] font-medium text-accent-ink transition-colors duration-fast ease-out hover:bg-accent-hover hover:border-accent-hover disabled:pointer-events-none disabled:opacity-45";
const secondaryButton = "inline-flex h-9 items-center justify-center rounded-md border border-line bg-panel px-3.5 text-[13px] font-medium text-ink2 transition-colors duration-fast ease-out hover:bg-hover hover:text-ink hover:border-line-strong disabled:pointer-events-none disabled:opacity-45";

function parseObject(value: string, label: string): Record<string, unknown> {
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

function amount(value: string, label: string): bigint {
  let parsed: bigint;
  try {
    parsed = parseUnits(value.trim(), 18);
  } catch {
    throw new Error(`Enter a valid ${label} amount.`);
  }
  if (parsed <= 0n) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function asBigInt(value: string): bigint {
  try { return BigInt(value); } catch { return 0n; }
}

function formatCapabilities(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink2">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[13px] leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}

export default function ProvidersPage() {
  const { address, balanceWei, connect } = useWallet();
  const providersState = useApi<Provider[]>("/providers", 3000);
  const listingsState = useApi<Listing[]>("/listings?all=true", 3000);
  const offersState = useApi<InferenceOffer[]>("/offers", 3000);
  const leasesState = useApi<Lease[]>("/leases", 5000);
  const creditsState = useApi<InferenceCredit[]>("/credits", 5000);
  const deploymentState = useApi<Deployment>("/deployment", 30000);

  const providers = providersState.data ?? [];
  const listings = listingsState.data ?? [];
  const offers = offersState.data ?? [];
  const addressKey = address?.toLowerCase() ?? "";
  const provider = providers.find((entry) => entry.address.toLowerCase() === addressKey);
  const myListings = listings.filter((entry) => entry.provider.toLowerCase() === addressKey);
  const myOffers = offers.filter((entry) => entry.provider.toLowerCase() === addressKey);
  const deployment = deploymentState.data?.contracts;
  const providerReady = Boolean(provider?.registered && provider.active && provider.attested && asBigInt(provider.stake) > 0n);

  const [capabilityDrafts, setCapabilityDrafts] = useState<Record<string, string>>({});
  const [stakeAmount, setStakeAmount] = useState("100");
  const [unstakeAmount, setUnstakeAmount] = useState("0");
  const [listingPrice, setListingPrice] = useState("1");
  const [intervalSecs, setIntervalSecs] = useState("3600");
  const [minIntervals, setMinIntervals] = useState("1");
  const [maxIntervals, setMaxIntervals] = useState("24");
  const [listingSpec, setListingSpec] = useState(DEFAULT_SPEC);
  const [model, setModel] = useState("meta-llama/Llama-3.1-8B-Instruct");
  const [tokenPrice, setTokenPrice] = useState("0.000002");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; hash?: string } | null>(null);
  const capabilitiesSource = provider?.capabilities || DEFAULT_CAPABILITIES;
  const capabilitiesKey = `${addressKey}:${capabilitiesSource}`;
  const capabilities = capabilityDrafts[capabilitiesKey] ?? formatCapabilities(capabilitiesSource);

  async function transact(key: string, prompt: string, write: () => Promise<Hash>) {
    setPending(key);
    setNotice({ text: prompt });
    try {
      const hash = await write();
      setNotice({ text: "Transaction submitted. Waiting for confirmation.", hash });
      await waitForTransaction(hash);
      setNotice({ text: "Transaction confirmed. Indexed data will refresh shortly.", hash });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message.split("\n")[0] : String(error), error: true });
    } finally {
      setPending(null);
    }
  }

  function requireAddress(): string | null {
    if (!address) {
      void connect();
      return null;
    }
    return address;
  }

  async function saveCapabilities() {
    const account = requireAddress();
    if (!account || !deployment?.ProviderRegistry) return;
    try {
      const parsed = parseObject(capabilities, "Capabilities");
      const canonical = JSON.stringify(parsed);
      await transact("capabilities", provider?.registered ? "Confirm the capabilities update in your wallet." : "Confirm provider registration in your wallet.", () =>
        provider?.registered
          ? updateProviderCapabilities(account, deployment.ProviderRegistry, canonical)
          : registerProvider(account, deployment.ProviderRegistry, canonical),
      );
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  }

  async function addStake() {
    const account = requireAddress();
    if (!account || !deployment?.ProviderRegistry || !deployment.SmeshToken) return;
    try {
      const value = amount(stakeAmount, "stake");
      if (value > balanceWei) throw new Error("Stake amount exceeds the connected wallet balance.");
      setPending("stake");
      setNotice({ text: "Approve the Provider Registry to transfer this SMESH." });
      const approval = await approveProviderStake(account, deployment.SmeshToken, deployment.ProviderRegistry, value);
      setNotice({ text: "Approval submitted. Waiting for confirmation.", hash: approval });
      await waitForTransaction(approval);
      setNotice({ text: "Approval confirmed. Confirm the stake transaction." });
      const hash = await stakeProvider(account, deployment.ProviderRegistry, value);
      setNotice({ text: "Stake submitted. Waiting for confirmation.", hash });
      await waitForTransaction(hash);
      setNotice({ text: "Stake confirmed. Indexed balances will refresh shortly.", hash });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message.split("\n")[0] : String(error), error: true });
    } finally {
      setPending(null);
    }
  }

  async function removeStake() {
    const account = requireAddress();
    if (!account || !deployment?.ProviderRegistry || !provider) return;
    try {
      const value = amount(unstakeAmount, "unstake");
      if (value > asBigInt(provider.availableStake)) throw new Error("Unstake amount exceeds free stake. Bonded stake cannot be withdrawn.");
      await transact("unstake", "Confirm the free-stake withdrawal in your wallet.", () => unstakeProvider(account, deployment.ProviderRegistry, value));
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  }

  async function publishListing() {
    const account = requireAddress();
    if (!account || !deployment?.RentalMarket) return;
    try {
      const price = amount(listingPrice, "price");
      const interval = Number(intervalSecs);
      const minimum = Number(minIntervals);
      const maximum = Number(maxIntervals);
      if (![interval, minimum, maximum].every(Number.isSafeInteger) || interval <= 0 || minimum < 1 || maximum < minimum) {
        throw new Error("Use whole numbers, a positive interval, and duration bounds where maximum is at least minimum.");
      }
      const spec = parseObject(listingSpec, "Listing spec");
      if (typeof spec.gpu !== "string" || !spec.gpu.trim()) throw new Error("Listing spec requires a non-empty gpu string.");
      if (!Number.isFinite(Number(spec.vram)) || Number(spec.vram) <= 0) throw new Error("Listing spec requires positive numeric vram.");
      if (typeof spec.region !== "string" || !spec.region.trim()) throw new Error("Listing spec requires a non-empty region string.");
      if (!Array.isArray(spec.models) || spec.models.some((entry) => typeof entry !== "string" || !entry.trim())) throw new Error("Listing spec models must be an array of non-empty strings.");
      if (spec.endpoint !== undefined) {
        let endpoint: URL;
        try { endpoint = new URL(String(spec.endpoint)); } catch { throw new Error("Listing endpoint must be a valid HTTP or HTTPS URL."); }
        if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error("Listing endpoint must use HTTP or HTTPS.");
      }
      await transact("listing", "Confirm the new rental listing in your wallet.", () => createRentalListing({
        account,
        rental: deployment.RentalMarket,
        pricePerInterval: price,
        intervalSecs: interval,
        minIntervals: minimum,
        maxIntervals: maximum,
        spec: JSON.stringify(spec),
      }));
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  }

  async function publishOffer() {
    const account = requireAddress();
    if (!account || !deployment?.InferenceMarket) return;
    try {
      const identifier = model.trim();
      if (!identifier) throw new Error("Model identifier is required.");
      const price = amount(tokenPrice, "token price");
      await transact("offer", "Confirm the inference offer in your wallet.", () => createInferenceOffer(account, deployment.InferenceMarket, identifier, price));
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  }

  const leaseEarnings = (leasesState.data ?? [])
    .filter((lease) => lease.provider.toLowerCase() === addressKey)
    .reduce((total, lease) => total + asBigInt(lease.pricePerInterval) * BigInt(lease.settledIntervals), 0n);
  const inferenceEarnings = (creditsState.data ?? [])
    .filter((credit) => credit.provider.toLowerCase() === addressKey)
    .reduce((total, credit) => total + asBigInt(credit.paid), 0n);
  const totalEarnings = leaseEarnings + inferenceEarnings;
  const apiError = providersState.error ?? listingsState.error ?? offersState.error ?? deploymentState.error;

  return (
    <div className="space-y-5">
      {notice && (
        <div role={notice.error ? "alert" : "status"} aria-live="polite" className={`flex flex-wrap items-center justify-between gap-3 rounded-md border bg-panel px-4 py-3 text-sm ${notice.error ? "border-danger/40 text-danger" : "border-line text-ink2"}`}>
          <span>{notice.text}</span>
          {notice.hash && <CopyValue value={notice.hash} label="transaction hash" />}
        </div>
      )}
      {apiError && <div role="alert" className="rounded-md border border-danger/40 bg-panel px-4 py-3 text-sm text-danger">Provider data could not be fully refreshed. {apiError}</div>}

      {!address ? (
        <Card>
          <div className="flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
            <div><h2 className="text-base font-semibold">Operate as a provider</h2><p className="mt-1 max-w-2xl text-sm text-muted">Connect the wallet that will own provider registration, stake, listings, and offers.</p></div>
            <button type="button" onClick={connect} className={primaryButton}>Connect wallet</button>
          </div>
        </Card>
      ) : (
        <>
          <section className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="flex flex-col gap-4 border-b border-line px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0"><p className="text-xs text-muted">Operator wallet</p><CopyValue value={address} label="provider address" /></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending !== null || !deployment?.SmeshToken} onClick={() => deployment?.SmeshToken && transact("faucet", "Confirm the testnet faucet claim in your wallet.", () => claimFaucet(address, deployment.SmeshToken))} className={secondaryButton}>{pending === "faucet" ? "Claiming..." : "Claim 1,000 SMESH"}</button>
                {provider?.registered && <button type="button" disabled={pending !== null || !deployment?.ProviderRegistry} onClick={() => deployment?.ProviderRegistry && transact("active", `Confirm provider ${provider.active ? "deactivation" : "activation"} in your wallet.`, () => setProviderActive(address, deployment.ProviderRegistry, !provider.active))} className={provider.active ? secondaryButton : primaryButton}>{pending === "active" ? "Updating..." : provider.active ? "Set inactive" : "Set active"}</button>}
              </div>
            </div>
            <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-6">
              {[
                ["Status", provider?.registered ? (provider.active ? "Active" : "Inactive") : "Not registered"],
                ["Stake", fmtSmesh(provider?.stake ?? "0")],
                ["Bonded", fmtSmesh(provider?.bonded ?? "0")],
                ["Free stake", fmtSmesh(provider?.availableStake ?? "0")],
                ["Reputation", `${repScore(provider?.reputation ?? 5000)} / 100`],
                ["Indexed earnings", fmtSmesh(totalEarnings)],
              ].map(([label, value]) => <div key={label} className="bg-surface px-4 py-3"><span className="block text-[12px] text-faint">{label}</span><b className="mono mt-1 block truncate text-[14px] font-medium" title={value}>{value}</b></div>)}
            </div>
            {provider?.registered && (
              <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line px-4 py-3 text-xs text-muted">
                <span>Attestation: <b className={provider.attested ? "font-medium text-success" : "font-medium text-accent"}>{provider.attested ? `${provider.gpu || "Hardware"}, ${provider.vramGB} GB, score ${provider.benchmarkScore}` : "Required for market offers"}</b></span>
                <span>Outcomes: <b className="font-medium text-ink2">{provider.completed} completed, {provider.failed} failed</b></span>
                <span>Earnings: <b className="font-medium text-ink2">{fmtSmesh(leaseEarnings)} rental, {fmtSmesh(inferenceEarnings)} inference</b></span>
              </div>
            )}
          </section>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)]">
            <div className="space-y-5">
              <Card>
                <CardHead title={provider?.registered ? "Capabilities" : "Register provider"} sub="On-chain JSON profile" />
                <div className="p-4">
                  <Field label="Capabilities JSON" htmlFor="capabilities" hint="Use gpuModel, vramGB, cpu, and models fields so the registry remains searchable.">
                    <textarea
                      id="capabilities"
                      value={capabilities}
                      onChange={(event) => setCapabilityDrafts((current) => ({ ...current, [capabilitiesKey]: event.target.value }))}
                      rows={8}
                      spellCheck={false}
                      className={`${inputClass} mono resize-y text-xs leading-relaxed`}
                    />
                  </Field>
                  <div className="mt-3 flex justify-end"><button type="button" onClick={saveCapabilities} disabled={pending !== null || providersState.loading || !deployment?.ProviderRegistry} className={primaryButton}>{providersState.loading ? "Loading provider..." : pending === "capabilities" ? "Confirming..." : provider?.registered ? "Update capabilities" : "Register provider"}</button></div>
                </div>
              </Card>

              <Card>
                <CardHead title="Collateral" sub="Only unbonded stake can be withdrawn" />
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <Field label="Add stake" htmlFor="stake-amount" hint={`Wallet balance: ${fmtSmesh(balanceWei)}`}>
                    <div className="flex gap-2"><input id="stake-amount" value={stakeAmount} onChange={(event) => setStakeAmount(event.target.value)} inputMode="decimal" className={`${inputClass} mono min-w-0`} /><button type="button" onClick={addStake} disabled={pending !== null || !provider?.registered} className={primaryButton}>{pending === "stake" ? "Staking..." : "Approve and stake"}</button></div>
                  </Field>
                  <Field label="Withdraw free stake" htmlFor="unstake-amount" hint={`${fmtSmesh(provider?.availableStake ?? "0")} currently free`}>
                    <div className="flex gap-2"><input id="unstake-amount" value={unstakeAmount} onChange={(event) => setUnstakeAmount(event.target.value)} inputMode="decimal" className={`${inputClass} mono min-w-0`} /><button type="button" onClick={removeStake} disabled={pending !== null || !provider?.registered || asBigInt(provider.availableStake) === 0n} className={secondaryButton}>{pending === "unstake" ? "Withdrawing..." : "Unstake"}</button></div>
                  </Field>
                </div>
              </Card>

              <Card>
                <CardHead title="Create rental listing" sub="Requires active status, stake, and fresh attestation" />
                <div className="space-y-4 p-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Price per interval" htmlFor="listing-price"><input id="listing-price" value={listingPrice} onChange={(event) => setListingPrice(event.target.value)} inputMode="decimal" className={`${inputClass} mono`} /></Field>
                    <Field label="Interval seconds" htmlFor="interval-secs"><input id="interval-secs" value={intervalSecs} onChange={(event) => setIntervalSecs(event.target.value)} inputMode="numeric" className={`${inputClass} mono`} /></Field>
                    <Field label="Minimum intervals" htmlFor="min-intervals"><input id="min-intervals" value={minIntervals} onChange={(event) => setMinIntervals(event.target.value)} inputMode="numeric" className={`${inputClass} mono`} /></Field>
                    <Field label="Maximum intervals" htmlFor="max-intervals"><input id="max-intervals" value={maxIntervals} onChange={(event) => setMaxIntervals(event.target.value)} inputMode="numeric" className={`${inputClass} mono`} /></Field>
                  </div>
                  <Field label="Listing spec JSON" htmlFor="listing-spec" hint="gpu, vram, region, and models are required. endpoint is optional and must use HTTP or HTTPS."><textarea id="listing-spec" value={listingSpec} onChange={(event) => setListingSpec(event.target.value)} rows={7} spellCheck={false} className={`${inputClass} mono resize-y text-xs leading-relaxed`} /></Field>
                  {!providerReady && <p className="text-xs text-accent">Register, activate, stake, and complete hardware attestation before publishing.</p>}
                  <div className="flex justify-end"><button type="button" onClick={publishListing} disabled={pending !== null || !providerReady || !deployment?.RentalMarket} className={primaryButton}>{pending === "listing" ? "Publishing..." : "Create listing"}</button></div>
                </div>
              </Card>
            </div>

            <div className="space-y-5">
              <Card>
                <CardHead title="Inference offer" sub="Publish metered model capacity" />
                <div className="space-y-4 p-4">
                  <Field label="Model identifier" htmlFor="offer-model"><input id="offer-model" value={model} onChange={(event) => setModel(event.target.value)} className={`${inputClass} mono text-xs`} /></Field>
                  <Field label="SMESH per token" htmlFor="token-price"><input id="token-price" value={tokenPrice} onChange={(event) => setTokenPrice(event.target.value)} inputMode="decimal" className={`${inputClass} mono`} /></Field>
                  {!providerReady && <p className="text-xs text-accent">Active, staked, attested providers can publish offers.</p>}
                  <button type="button" onClick={publishOffer} disabled={pending !== null || !providerReady || !deployment?.InferenceMarket} className={`w-full ${primaryButton}`}>{pending === "offer" ? "Publishing..." : "Create inference offer"}</button>
                </div>
              </Card>

              <Card>
                <CardHead title="Your listings" sub={`${myListings.length} indexed`} />
                {myListings.length === 0 ? <Empty title="No rental listings" hint="Publish attested capacity to make it available" /> : <div className="divide-y divide-line">{myListings.map((listing) => <div key={listing.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><b className="text-sm font-medium">{listing.gpu || `Listing #${listing.id}`}</b><p className="mono mt-0.5 text-[11px] text-faint">#{listing.id} · {fmtSmesh(listing.pricePerInterval)} / {fmtInterval(listing.intervalSecs)} · {listing.minIntervals}-{listing.maxIntervals} intervals</p></div><StatusTag status={listing.available ? "Active" : listing.activeLeaseId ? "Reserved" : "Inactive"} />{listing.activeLeaseId === 0 && <button type="button" disabled={pending !== null || !deployment?.RentalMarket} onClick={() => deployment?.RentalMarket && transact(`listing-${listing.id}`, `Confirm listing #${listing.id} ${listing.available ? "deactivation" : "activation"}.`, () => setRentalListingAvailable(address, deployment.RentalMarket, listing.id, !listing.available))} className={secondaryButton}>{pending === `listing-${listing.id}` ? "Updating..." : listing.available ? "Deactivate" : "Activate"}</button>}</div>)}</div>}
              </Card>

              <Card>
                <CardHead title="Your inference offers" sub={`${myOffers.filter((offer) => offer.active).length} active`} />
                {myOffers.length === 0 ? <Empty title="No inference offers" hint="Publish a model and per-token price" /> : <div className="divide-y divide-line">{myOffers.map((offer) => <div key={offer.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><b className="mono block truncate text-xs font-medium" title={offer.modelIdentifier}>{offer.modelIdentifier}</b><p className="mono mt-1 text-[11px] text-faint">Offer #{offer.id} · {fmtSmesh(offer.pricePerToken, 6)} / token</p></div><StatusTag status={offer.active ? "Active" : "Inactive"} />{offer.active && <button type="button" disabled={pending !== null || !deployment?.InferenceMarket} onClick={() => deployment?.InferenceMarket && transact(`offer-${offer.id}`, `Confirm offer #${offer.id} deactivation.`, () => deactivateInferenceOffer(address, deployment.InferenceMarket, offer.id))} className={secondaryButton}>{pending === `offer-${offer.id}` ? "Updating..." : "Deactivate"}</button>}</div>)}</div>}
              </Card>
            </div>
          </div>
        </>
      )}

      <Card>
        <CardHead title="Provider registry" sub={`${providers.length} indexed providers`} />
        {providersState.loading ? <div role="status" aria-label="Loading providers" className="space-y-3 p-4">{[0, 1, 2].map((row) => <div key={row} className="h-10 animate-pulse rounded-md bg-panel" />)}</div> : providersState.error ? <Empty title="Provider registry could not be loaded" hint="Check the orchestrator connection" /> : providers.length === 0 ? <Empty title="No registered providers" hint="Connect a wallet and register the first provider" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[920px] border-collapse"><thead><tr className="text-left text-[11px] uppercase tracking-wide text-faint"><th className="border-b border-line px-4 py-2.5 font-medium">Provider</th><th className="border-b border-line px-4 py-2.5 font-medium">Status</th><th className="border-b border-line px-4 py-2.5 font-medium">Hardware</th><th className="border-b border-line px-4 py-2.5 font-medium">Stake</th><th className="border-b border-line px-4 py-2.5 font-medium">Reputation</th><th className="border-b border-line px-4 py-2.5 font-medium">Outcomes</th></tr></thead><tbody>{providers.map((entry) => <tr key={entry.address} className="text-[13px] hover:bg-hover"><td className="border-b border-line px-4 py-3"><CopyValue value={entry.address} label="provider address" /></td><td className="border-b border-line px-4 py-3"><StatusTag status={entry.active ? "Active" : "Inactive"} /></td><td className="border-b border-line px-4 py-3"><span className="block text-ink2">{entry.gpu || "Not declared"}{entry.vramGB ? ` · ${entry.vramGB} GB` : ""}</span><small className={entry.attested ? "text-success" : "text-faint"}>{entry.attested ? `Attested · score ${entry.benchmarkScore}` : "Not attested"}</small></td><td className="mono border-b border-line px-4 py-3"><span className="block">{fmtSmesh(entry.stake)}</span><small className="text-faint">{fmtSmesh(entry.availableStake)} free</small></td><td className="border-b border-line px-4 py-3"><RepBar score={repScore(entry.reputation)} /></td><td className="mono border-b border-line px-4 py-3 text-xs text-muted">{entry.completed} passed · {entry.failed} failed</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
