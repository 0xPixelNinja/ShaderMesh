"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { Card, CardHead, GpuChip, Empty, RepBar } from "@/components/ui";
import { fmtUsd, shortAddr, repScore, fmtInterval } from "@/lib/format";
import { requestLease } from "@/lib/actions";
import { DEFAULT_LEASE_MANIFEST, isContentAddressedManifest } from "@/lib/config";
import type { Deployment, Listing, Provider } from "@/lib/types";

function pricePerHour(listing: Listing): number {
  const perInterval = Number(listing.pricePerInterval) / 1e18;
  return listing.intervalSecs ? perInterval * (3600 / listing.intervalSecs) : perInterval;
}

export default function RentPage() {
  const { address, connect } = useWallet();
  const listingsState = useApi<Listing[]>("/listings");
  const providersState = useApi<Provider[]>("/providers");
  const deploymentState = useApi<Deployment>("/deployment", 30000);
  const listings = listingsState.data ?? [];
  const providers = providersState.data ?? [];
  const deployment = deploymentState.data;
  const availableListings = listings.filter((listing) => listing.available);

  const repByAddr = new Map(providers.map((provider) => [provider.address.toLowerCase(), provider]));
  const [pending, setPending] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [intervals, setIntervals] = useState<Record<number, number>>({});
  const [manifests, setManifests] = useState<Record<number, string>>({});

  function selectedIntervals(listing: Listing): number {
    return intervals[listing.id] ?? Math.max(listing.minIntervals, Math.min(listing.maxIntervals, 24));
  }

  function selectedManifest(listing: Listing): string {
    return manifests[listing.id] ?? DEFAULT_LEASE_MANIFEST;
  }

  async function handleRequest(listing: Listing) {
    setMsg(null);
    const count = selectedIntervals(listing);
    const manifest = selectedManifest(listing).trim();

    if (!Number.isInteger(count) || count < listing.minIntervals || count > listing.maxIntervals) {
      setMsg(`Choose between ${listing.minIntervals} and ${listing.maxIntervals} intervals for ${listing.gpu || "this listing"}.`);
      return;
    }
    if (!isContentAddressedManifest(manifest)) {
      setMsg("Enter a content-addressed manifest URI, for example ipfs://<CID>.");
      return;
    }
    if (!address) {
      await connect();
      return;
    }
    if (!deployment?.contracts?.RentalMarket || !deployment.contracts.SmeshToken) {
      setMsg("Deployment not available yet.");
      return;
    }

    setPending(listing.id);
    try {
      await requestLease({
        account: address,
        token: deployment.contracts.SmeshToken,
        rental: deployment.contracts.RentalMarket,
        listingId: listing.id,
        pricePerInterval: listing.pricePerInterval,
        intervals: count,
        manifest,
      });
      setMsg(`Lease request submitted for ${listing.gpu || "compute"}. It remains pending until the provider accepts it.`);
    } catch (error) {
      setMsg("Request failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPending(null);
    }
  }

  const apiError = listingsState.error ?? providersState.error ?? deploymentState.error;

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden">
      <div className="mb-4 rounded-md border border-line bg-panel px-4 py-3 text-sm text-ink2">
        Requests await provider acceptance. Your escrow is deposited when you submit, but no provider bond is locked and no lease clock starts before acceptance.
      </div>
      {msg && (
        <div role="status" className="mb-4 rounded-md border border-line bg-panel px-4 py-2.5 text-sm text-ink2">
          {msg}
        </div>
      )}
      {apiError && (
        <div role="alert" className="mb-4 rounded-md border border-danger/40 bg-panel px-4 py-2.5 text-sm text-danger">
          Some marketplace data could not be loaded. {apiError}
        </div>
      )}
      <Card className="w-full max-w-full">
        <CardHead title="Available GPUs" sub={`${availableListings.length} offers`} />
        {listingsState.loading ? (
          <div role="status" className="space-y-3 px-4 py-5" aria-label="Loading available GPUs">
            {[0, 1, 2].map((row) => <div key={row} className="h-10 animate-pulse rounded-md bg-panel" />)}
          </div>
        ) : listingsState.error ? (
          <Empty title="Available GPUs could not be loaded" hint="Check the orchestrator connection and try again" />
        ) : availableListings.length === 0 ? (
          <Empty title="No GPUs listed yet" hint="Start a provider agent to list capacity" />
        ) : (
          <div className="relative w-full max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[1120px] border-collapse">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="border-b border-line px-4 py-2.5 font-medium">GPU</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Provider</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Price</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Interval</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Reputation</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Duration</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Manifest</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {availableListings.map((listing) => {
                  const provider = repByAddr.get(listing.provider.toLowerCase());
                  const count = selectedIntervals(listing);
                  const escrowIntervals = Number.isInteger(count) ? count : 0;
                  return (
                    <tr key={listing.id} className="text-[13px] hover:bg-hover">
                      <td className="border-b border-line px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <GpuChip />
                          <div>
                            <b className="font-medium">{listing.gpu || "Compute"}</b>
                            <small className="mono block text-[11px] text-faint">
                              {listing.vramGB ? `${listing.vramGB} GB · ` : ""}
                              {listing.region || "local"}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="mono border-b border-line px-4 py-3 text-xs text-muted">{shortAddr(listing.provider)}</td>
                      <td className="mono border-b border-line px-4 py-3">
                        <b className="font-semibold">${pricePerHour(listing).toFixed(2)}</b>
                        <span className="text-faint"> /hr</span>
                        <small className="block text-[11px] text-faint">
                          {fmtUsd(BigInt(listing.pricePerInterval) * BigInt(escrowIntervals))} escrow
                        </small>
                      </td>
                      <td className="mono border-b border-line px-4 py-3 text-muted">{fmtInterval(listing.intervalSecs)}</td>
                      <td className="border-b border-line px-4 py-3">
                        <RepBar score={provider ? repScore(provider.reputation) : 50} />
                      </td>
                      <td className="border-b border-line px-4 py-3">
                        <label className="sr-only" htmlFor={`intervals-${listing.id}`}>Intervals for {listing.gpu || `listing ${listing.id}`}</label>
                        <input
                          id={`intervals-${listing.id}`}
                          type="number"
                          min={listing.minIntervals}
                          max={listing.maxIntervals}
                          step={1}
                          value={count}
                          onChange={(event) => {
                            const value = event.currentTarget.valueAsNumber;
                            setIntervals((current) => ({ ...current, [listing.id]: Number.isFinite(value) ? value : listing.minIntervals }));
                          }}
                          className="mono w-20 rounded-md border border-line-strong bg-bg px-2.5 py-1.5 text-xs text-ink focus:border-accent"
                        />
                        <small className="mono mt-1 block text-[11px] text-faint">{listing.minIntervals}–{listing.maxIntervals}</small>
                      </td>
                      <td className="border-b border-line px-4 py-3">
                        <label className="sr-only" htmlFor={`manifest-${listing.id}`}>IPFS manifest for {listing.gpu || `listing ${listing.id}`}</label>
                        <input
                          id={`manifest-${listing.id}`}
                          type="url"
                          required
                          spellCheck={false}
                          value={selectedManifest(listing)}
                          onChange={(event) => setManifests((current) => ({ ...current, [listing.id]: event.currentTarget.value }))}
                          placeholder="ipfs://<CID>"
                          className="mono w-72 rounded-md border border-line-strong bg-bg px-2.5 py-1.5 text-xs text-ink placeholder:text-muted focus:border-accent"
                        />
                      </td>
                      <td className="border-b border-line px-4 py-3 text-right">
                        <button
                          onClick={() => handleRequest(listing)}
                          disabled={pending !== null}
                          className="rounded-md border border-accent bg-accent px-3.5 py-1.5 text-xs font-semibold text-[#1A1205] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {pending === listing.id ? "Requesting…" : "Request lease"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mono mt-3 text-xs text-faint">
        Prices in USD at 1 SMESH = $1. After acceptance, escrow streams per verified interval; unused time is refundable and downtime is slashed.
      </p>
    </div>
  );
}
