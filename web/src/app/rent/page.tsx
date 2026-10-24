"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import {
  Button,
  Card,
  CardHead,
  Empty,
  ErrorNote,
  Field,
  GpuChip,
  Input,
  Note,
  RepBar,
  Skeleton,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { fmtInterval, fmtUsd, repScore, shortAddr, usd } from "@/lib/format";
import { requestLease } from "@/lib/actions";
import { DEFAULT_LEASE_MANIFEST, isContentAddressedManifest } from "@/lib/config";
import type { Deployment, Listing, Provider } from "@/lib/types";

function pricePerHour(listing: Listing): number {
  const perInterval = usd(listing.pricePerInterval);
  return listing.intervalSecs ? perInterval * (3600 / listing.intervalSecs) : perInterval;
}

function defaultIntervals(listing: Listing): number {
  return Math.max(listing.minIntervals, Math.min(listing.maxIntervals, 24));
}

/** Humanised lease duration, e.g. 24 intervals of 60s becomes "24m". */
function totalDuration(listing: Listing, count: number): string {
  const secs = listing.intervalSecs * count;
  if (!Number.isFinite(secs) || secs <= 0) return "-";
  if (secs >= 86400) return `${(secs / 86400).toFixed(secs % 86400 ? 1 : 0)}d`;
  if (secs >= 3600) return `${(secs / 3600).toFixed(secs % 3600 ? 1 : 0)}h`;
  return `${Math.round(secs / 60)}m`;
}

export default function RentPage() {
  const { address, connect, connecting } = useWallet();
  const listingsState = useApi<Listing[]>("/listings", 5000);
  const providersState = useApi<Provider[]>("/providers", 8000);
  const deploymentState = useApi<Deployment>("/deployment", 30000);

  const listings = useMemo(() => listingsState.data ?? [], [listingsState.data]);
  const providers = providersState.data ?? [];
  const deployment = deploymentState.data;

  const available = useMemo(
    () => listings.filter((listing) => listing.available),
    [listings],
  );
  const repByAddr = new Map(providers.map((p) => [p.address.toLowerCase(), p]));

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [intervals, setIntervals] = useState<number | null>(null);
  const [manifest, setManifest] = useState(DEFAULT_LEASE_MANIFEST);
  const [showManifest, setShowManifest] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Derive the selection rather than storing it, so capacity being leased or
  // released around us falls back to the first available listing without an effect.
  const selected = available.find((l) => l.id === selectedId) ?? available[0] ?? null;
  const count = intervals ?? (selected ? defaultIntervals(selected) : 0);
  const escrow = selected
    ? (BigInt(selected.pricePerInterval) * BigInt(Number.isInteger(count) && count > 0 ? count : 0)).toString()
    : "0";

  const intervalsValid =
    !!selected && Number.isInteger(count) && count >= selected.minIntervals && count <= selected.maxIntervals;
  const manifestValid = isContentAddressedManifest(manifest.trim());

  async function handleRequest() {
    if (!selected) return;
    setNotice(null);
    setFailure(null);

    if (!intervalsValid) {
      setFailure(`Choose between ${selected.minIntervals} and ${selected.maxIntervals} intervals.`);
      return;
    }
    if (!manifestValid) {
      setFailure("Enter a content-addressed manifest URI, for example ipfs://<CID>.");
      setShowManifest(true);
      return;
    }
    if (!address) {
      await connect();
      return;
    }
    if (!deployment?.contracts?.RentalMarket || !deployment.contracts.SmeshToken) {
      setFailure("Deployment is not available yet. Check the orchestrator connection.");
      return;
    }

    setPending(true);
    try {
      await requestLease({
        account: address,
        token: deployment.contracts.SmeshToken,
        rental: deployment.contracts.RentalMarket,
        listingId: selected.id,
        pricePerInterval: selected.pricePerInterval,
        intervals: count,
        manifest: manifest.trim(),
      });
      setNotice(
        `Lease requested for ${selected.gpu || "compute"}. It stays pending until the provider accepts, then the clock and escrow start.`,
      );
    } catch (error) {
      setFailure("Request failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPending(false);
    }
  }

  const apiError = listingsState.error ?? providersState.error ?? deploymentState.error;

  return (
    <div className="space-y-5">
      {apiError && <ErrorNote>Some marketplace data could not be loaded. {apiError}</ErrorNote>}

      <div className="grid items-start gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Card>
          <CardHead
            title="Available GPUs"
            sub={`${available.length} ${available.length === 1 ? "provider is" : "providers are"} ready to accept a lease`}
          />
          {listingsState.loading ? (
            <Skeleton label="Loading available GPUs" rows={3} />
          ) : listingsState.error ? (
            <Empty
              icon="alert"
              title="Available GPUs could not be loaded"
              hint="Check the orchestrator connection and try again."
            />
          ) : available.length === 0 ? (
            <Empty
              icon="gpu"
              title="No capacity listed right now"
              hint="Providers publish capacity from the provider console after staking collateral and passing attestation."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <caption className="sr-only">Available GPU listings. Select one to configure a lease.</caption>
                <thead>
                  <tr>
                    <Th className="w-10" />
                    <Th>GPU</Th>
                    <Th>Provider</Th>
                    <Th>Reputation</Th>
                    <Th align="right">Price</Th>
                    <Th align="right">Interval</Th>
                  </tr>
                </thead>
                <tbody>
                  {available.map((listing) => {
                    const provider = repByAddr.get(listing.provider.toLowerCase());
                    // Compare against the derived selection so the fallback row
                    // reads as checked, not just highlighted.
                    const isSelected = listing.id === selected?.id;
                    return (
                      <Tr key={listing.id}>
                        <Td className={isSelected ? "bg-accent-weak" : ""}>
                          <input
                            type="radio"
                            name="listing"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedId(listing.id);
                              setIntervals(null);
                              setNotice(null);
                              setFailure(null);
                            }}
                            aria-label={`Select ${listing.gpu || `listing ${listing.id}`}`}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                        </Td>
                        <Td className={isSelected ? "bg-accent-weak" : ""}>
                          <div className="flex items-center gap-3">
                            <GpuChip live={isSelected} />
                            <div className="min-w-0">
                              <div className="font-medium text-ink">{listing.gpu || "Compute"}</div>
                              <div className="truncate text-[12px] text-faint">
                                {listing.vramGB ? `${listing.vramGB} GB · ` : ""}
                                {listing.region || "local"}
                                {listing.models.length ? ` · ${listing.models.join(", ")}` : ""}
                              </div>
                            </div>
                          </div>
                        </Td>
                        <Td className={`mono text-muted ${isSelected ? "bg-accent-weak" : ""}`}>
                          {shortAddr(listing.provider)}
                        </Td>
                        <Td className={isSelected ? "bg-accent-weak" : ""}>
                          <RepBar score={provider ? repScore(provider.reputation) : 50} />
                        </Td>
                        <Td align="right" className={`mono ${isSelected ? "bg-accent-weak" : ""}`}>
                          <span className="font-semibold text-ink">
                            ${pricePerHour(listing).toFixed(2)}
                          </span>
                          <span className="text-faint">/hr</span>
                        </Td>
                        <Td align="right" className={`mono text-muted ${isSelected ? "bg-accent-weak" : ""}`}>
                          {fmtInterval(listing.intervalSecs)}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            title="Configure lease"
            sub={selected ? selected.gpu || `Listing #${selected.id}` : "Select a GPU to continue"}
          />
          {!selected ? (
            <Empty
              icon="gpu"
              title="Nothing selected"
              hint="Choose a GPU from the list to set the duration and review the escrow before you commit funds."
            />
          ) : (
            <div className="space-y-4 p-5">
              <Field
                label="Duration"
                hint={`${selected.minIntervals} to ${selected.maxIntervals} intervals of ${fmtInterval(selected.intervalSecs)}`}
                error={!intervalsValid && intervals !== null ? "Outside the allowed range." : undefined}
              >
                <div className="flex items-center gap-3">
                  <div className="w-24 shrink-0">
                    <Input
                      type="number"
                      className="mono"
                      min={selected.minIntervals}
                      max={selected.maxIntervals}
                      step={1}
                      value={Number.isFinite(count) ? count : ""}
                      invalid={intervals !== null && !intervalsValid}
                      onChange={(e) => {
                        const v = e.currentTarget.valueAsNumber;
                        setIntervals(Number.isFinite(v) ? v : 0);
                        setFailure(null);
                      }}
                    />
                  </div>
                  <span className="min-w-0 text-[13px] text-muted">
                    intervals, <span className="mono text-ink2">{totalDuration(selected, count)}</span> total
                  </span>
                </div>
              </Field>

              <dl className="rounded-lg border border-line bg-panel px-4 py-3 text-[13px]">
                <div className="flex items-center justify-between py-1">
                  <dt className="text-muted">Rate</dt>
                  <dd className="mono text-ink2">
                    {fmtUsd(selected.pricePerInterval)} / {fmtInterval(selected.intervalSecs)}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-line py-1 pt-2">
                  <dt className="font-medium text-ink">Escrow to deposit</dt>
                  <dd className="mono text-[15px] font-semibold text-accent">{fmtUsd(escrow)}</dd>
                </div>
              </dl>

              <div>
                <button
                  type="button"
                  onClick={() => setShowManifest((v) => !v)}
                  aria-expanded={showManifest}
                  className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-muted transition-colors duration-fast ease-out hover:text-ink"
                >
                  Workload manifest
                  <span className={`transition-transform duration-fast ease-out ${showManifest ? "rotate-180" : ""}`}>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </button>
                {showManifest && (
                  <div className="mt-2.5">
                    <Field
                      label="Content-addressed manifest"
                      hint="The provider only accepts leases bound to a manifest it has allowlisted."
                      error={!manifestValid ? "Must be an ipfs:// content-addressed URI." : undefined}
                    >
                      <Input
                        type="url"
                        spellCheck={false}
                        className="mono"
                        value={manifest}
                        invalid={!manifestValid}
                        placeholder="ipfs://<CID>"
                        onChange={(e) => setManifest(e.currentTarget.value)}
                      />
                    </Field>
                  </div>
                )}
              </div>

              <Button
                variant="primary"
                className="w-full"
                icon={address ? "gpu" : "wallet"}
                loading={pending || connecting}
                onClick={handleRequest}
              >
                {!address ? "Connect wallet" : pending ? "Requesting" : `Request lease · ${fmtUsd(escrow)}`}
              </Button>

              {notice && (
                <div
                  role="status"
                  className="rounded-lg border border-success bg-success-weak px-4 py-3 text-[13px] leading-relaxed text-success"
                >
                  {notice}
                </div>
              )}
              {failure && <ErrorNote>{failure}</ErrorNote>}

              <Note>
                Escrow is deposited when you submit, but no provider bond is locked and no lease clock
                starts until the provider accepts. Provider agents accept automatically, usually within
                seconds, so there is nothing to approve by hand. Unused intervals are refundable and
                downtime is slashed from the provider&apos;s stake.
              </Note>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
