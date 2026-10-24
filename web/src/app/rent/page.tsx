"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { Button, Empty, ErrorNote, Field, Input, PageHeader, RepBar, Skeleton } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtAmount, fmtInterval, fmtSmesh, repScore, shortAddr } from "@/lib/format";
import { readBondPerLease, requestLease, waitForTransaction } from "@/lib/actions";
import { DEFAULT_LEASE_MANIFEST, isContentAddressedManifest } from "@/lib/config";
import type { Deployment, Listing, Provider } from "@/lib/types";

type Step = 1 | 2 | 3;
type Phase = "approve" | "request" | "confirm" | "done" | "error";

/** Price for one hour of the listing, in token base units. */
function pricePerHour(listing: Listing): bigint {
  const perInterval = BigInt(listing.pricePerInterval);
  return listing.intervalSecs ? (perInterval * 3600n) / BigInt(listing.intervalSecs) : perInterval;
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] text-ink transition-colors duration-fast ease-out hover:border-line-strong";

export default function RentPage() {
  const { address, balanceWei, connect, connecting } = useWallet();
  const [availableOnly, setAvailableOnly] = useState(true);
  const listingsState = useApi<Listing[]>(availableOnly ? "/listings" : "/listings?all=true", 5000);
  const providersState = useApi<Provider[]>("/providers", 8000);
  const deploymentState = useApi<Deployment>("/deployment", 30000);

  const listings = useMemo(() => listingsState.data ?? [], [listingsState.data]);
  const providers = providersState.data ?? [];
  const deployment = deploymentState.data;
  const rental = deployment?.contracts?.RentalMarket;
  const repByAddr = new Map(providers.map((p) => [p.address.toLowerCase(), p]));

  const [modelFilter, setModelFilter] = useState("");
  const [gpuFilter, setGpuFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [intervals, setIntervals] = useState<number | null>(null);
  const [manifest, setManifest] = useState(DEFAULT_LEASE_MANIFEST);
  const [step, setStep] = useState<Step>(1);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [bond, setBond] = useState<bigint | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  // The provider bond is a market parameter; read it once per deployment.
  useEffect(() => {
    if (!rental) return;
    let cancelled = false;
    readBondPerLease(rental)
      .then((value) => !cancelled && setBond(value))
      .catch(() => !cancelled && setBond(null));
    return () => {
      cancelled = true;
    };
  }, [rental]);

  const modelOptions = useMemo(
    () => [...new Set(listings.flatMap((l) => l.models))].sort(),
    [listings],
  );
  const gpuOptions = useMemo(
    () => [...new Set(listings.map((l) => l.gpu).filter(Boolean))].sort(),
    [listings],
  );

  const visible = listings.filter(
    (l) =>
      (!availableOnly || l.available) &&
      (!modelFilter || l.models.includes(modelFilter)) &&
      (!gpuFilter || l.gpu === gpuFilter),
  );
  const selectable = visible.filter((l) => l.available);
  const busy = phase === "approve" || phase === "request" || phase === "confirm";

  // Derive the selection rather than storing it, so capacity being leased or
  // released around us falls back to the first available listing without an effect.
  const selected = selectable.find((l) => l.id === selectedId) ?? selectable[0] ?? null;
  const count = intervals ?? (selected ? defaultIntervals(selected) : 0);
  const escrowWei = selected
    ? BigInt(selected.pricePerInterval) * BigInt(Number.isInteger(count) && count > 0 ? count : 0)
    : 0n;
  const escrow = escrowWei.toString();

  const intervalsValid =
    !!selected && Number.isInteger(count) && count >= selected.minIntervals && count <= selected.maxIntervals;
  const manifestValid = isContentAddressedManifest(manifest.trim());
  const deploymentReady = !!rental && !!deployment?.contracts?.SmeshToken;
  const enoughBalance = balanceWei >= escrowWei;

  function choose(listing: Listing) {
    if (busy) return;
    setSelectedId(listing.id);
    setIntervals(null);
    setStep(1);
    setPhase(null);
    setTxHash(null);
    setNotice(null);
    setFailure(null);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() =>
        composerRef.current?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" }),
      );
    }
  }

  async function handleRequest() {
    if (!selected) return;
    setNotice(null);
    setFailure(null);

    if (!intervalsValid) {
      setFailure(`Choose between ${selected.minIntervals} and ${selected.maxIntervals} intervals.`);
      setStep(1);
      return;
    }
    if (!manifestValid) {
      setFailure("Enter a content-addressed manifest URI, for example ipfs://<CID>.");
      setStep(1);
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

    setStep(3);
    setPhase("approve");
    setTxHash(null);
    try {
      const hash = await requestLease({
        account: address,
        token: deployment.contracts.SmeshToken,
        rental: deployment.contracts.RentalMarket,
        listingId: selected.id,
        pricePerInterval: selected.pricePerInterval,
        intervals: count,
        manifest: manifest.trim(),
        onStep: (s, h) => {
          if (s === "request") setPhase("request");
          if (h) setTxHash(h);
        },
      });
      setTxHash(hash);
      setPhase("confirm");
      await waitForTransaction(hash as `0x${string}`);
      setPhase("done");
      setNotice(
        `Lease requested for ${selected.gpu || "compute"}. It stays pending until the provider accepts, then the clock and escrow start.`,
      );
    } catch (error) {
      setPhase("error");
      setFailure("Request failed: " + errorText(error));
    }
  }

  const apiError = listingsState.error ?? providersState.error ?? deploymentState.error;
  const filtersActive = !!modelFilter || !!gpuFilter;

  return (
    <div>
      <PageHeader
        eyebrow="Rent"
        title="Marketplace"
        description="Lease a GPU by the interval. Escrow pays the provider only for intervals it proves with a signed heartbeat."
      />

      {apiError && (
        <div className="mb-6">
          <ErrorNote>Some marketplace data could not be loaded. {apiError}</ErrorNote>
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="listings-heading" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-line pb-3">
            <div className="min-w-0">
              <h2 id="listings-heading" className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
                Available GPUs
              </h2>
              <p className="mt-1 text-[13px] text-muted">
                {listingsState.loading
                  ? "Loading listings"
                  : `${selectable.length} ready to accept a lease${visible.length > selectable.length ? `, ${visible.length - selectable.length} leased` : ""}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {modelOptions.length > 0 && (
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <span>Model</span>
                  <select
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.currentTarget.value)}
                    className={`${SELECT_CLASS} w-auto min-w-[9rem]`}
                  >
                    <option value="">All models</option>
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {gpuOptions.length > 1 && (
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <span>GPU</span>
                  <select
                    value={gpuFilter}
                    onChange={(e) => setGpuFilter(e.currentTarget.value)}
                    className={`${SELECT_CLASS} w-auto min-w-[9rem]`}
                  >
                    <option value="">All GPUs</option>
                    {gpuOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-[13px] text-ink2">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.currentTarget.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Available only
              </label>
            </div>
          </div>

          {listingsState.loading ? (
            <Skeleton label="Loading available GPUs" rows={3} />
          ) : listingsState.error ? (
            <Empty
              icon="alert"
              title="Available GPUs could not be loaded"
              hint="Check the orchestrator connection and try again."
            />
          ) : visible.length === 0 ? (
            <Empty
              icon="gpu"
              title={filtersActive ? "No GPUs match these filters" : "No capacity listed right now"}
              hint={
                filtersActive
                  ? "Clear the model or GPU filter to see every listing."
                  : "Providers publish capacity from the provider console after staking collateral and passing attestation."
              }
              action={
                filtersActive ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setModelFilter("");
                      setGpuFilter("");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {visible.map((listing) => (
                <li key={listing.id} className="min-w-0">
                  <ListingCard
                    listing={listing}
                    provider={repByAddr.get(listing.provider.toLowerCase())}
                    selected={listing.id === selected?.id}
                    disabled={busy}
                    onSelect={() => choose(listing)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div ref={composerRef} className="min-w-0 scroll-mt-4 lg:sticky lg:top-0">
          <section
            aria-labelledby="composer-heading"
            className="rounded-lg border border-line bg-surface"
          >
            <div className="border-b border-line px-5 py-4">
              <h2 id="composer-heading" className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
                Configure lease
              </h2>
              <p className="mt-1 truncate text-[13px] text-muted">
                {selected ? `${selected.gpu || "Compute"}, listing #${selected.id}` : "Select a GPU to continue"}
              </p>
            </div>

            {!selected ? (
              <Empty
                icon="gpu"
                title="Nothing selected"
                hint="Choose a GPU to set the duration and review the escrow before you commit funds."
              />
            ) : (
              <div className="p-5">
                <Stepper step={step} />

                {step === 1 && (
                  <div className="mt-6 space-y-5">
                    <Field
                      label="Intervals"
                      hint={`${selected.minIntervals} to ${selected.maxIntervals} intervals of ${fmtInterval(selected.intervalSecs)}`}
                      error={!intervalsValid ? `Choose between ${selected.minIntervals} and ${selected.maxIntervals}.` : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-28 shrink-0">
                          <Input
                            type="number"
                            className="mono"
                            min={selected.minIntervals}
                            max={selected.maxIntervals}
                            step={1}
                            value={Number.isFinite(count) ? count : ""}
                            invalid={!intervalsValid}
                            onChange={(e) => {
                              const v = e.currentTarget.valueAsNumber;
                              setIntervals(Number.isFinite(v) ? v : 0);
                              setFailure(null);
                            }}
                          />
                        </div>
                        <span className="min-w-0 text-[13px] text-muted">
                          <span className="mono text-ink2">{totalDuration(selected, count)}</span> total,{" "}
                          <span className="mono text-ink2">{fmtSmesh(escrow)}</span>
                        </span>
                      </div>
                    </Field>

                    <Field
                      label="Workload manifest"
                      hint="A content-addressed container manifest. The provider only accepts manifests it has allowlisted."
                      error={!manifestValid ? "Enter an ipfs:// content-addressed URI." : undefined}
                    >
                      <Input
                        type="url"
                        spellCheck={false}
                        className="mono"
                        value={manifest}
                        invalid={!manifestValid}
                        placeholder="ipfs://<CID>"
                        onChange={(e) => {
                          setManifest(e.currentTarget.value);
                          setFailure(null);
                        }}
                      />
                    </Field>

                    {failure && <ErrorNote>{failure}</ErrorNote>}

                    <div>
                      <Button
                        variant="primary"
                        className="w-full"
                        disabled={!intervalsValid || !manifestValid}
                        onClick={() => {
                          setFailure(null);
                          setStep(2);
                        }}
                      >
                        Review lease
                      </Button>
                      {(!intervalsValid || !manifestValid) && (
                        <p className="mt-2 text-[12px] text-faint">
                          {!intervalsValid ? "Set a valid number of intervals to continue." : "Add a valid manifest to continue."}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="mt-6 space-y-5">
                    <dl className="divide-y divide-line text-[13px]">
                      <Row label="Rate">
                        {fmtSmesh(selected.pricePerInterval)} / {fmtInterval(selected.intervalSecs)}
                      </Row>
                      <Row label="Duration" mono={false}>
                        <span className="mono">{count}</span> x <span className="mono">{fmtInterval(selected.intervalSecs)}</span>, <span className="mono">{totalDuration(selected, count)}</span> total
                      </Row>
                      <Row label="Heartbeat" mono={false}>
                        Signed every <span className="mono">{fmtInterval(selected.intervalSecs)}</span>
                      </Row>
                      <Row label="Provider bond" mono={false}>
                        {bond !== null ? <span className="mono">{fmtSmesh(bond)}</span> : "Market rate"}, locked on accept
                      </Row>
                      <div className="flex items-baseline justify-between gap-4 py-3">
                        <dt className="font-medium text-ink">Escrow to deposit</dt>
                        <dd className="mono text-[18px] font-semibold text-ink">{fmtSmesh(escrow)}</dd>
                      </div>
                      {address && (
                        <Row label="Wallet balance">
                          <span className={enoughBalance ? "" : "text-danger"}>{fmtSmesh(balanceWei)}</span>
                        </Row>
                      )}
                    </dl>

                    <ul className="space-y-2 text-[13px] leading-relaxed text-muted">
                      <li className="flex gap-2.5">
                        <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
                        End the lease at any time: proven intervals are paid and the rest of the escrow is refunded.
                      </li>
                      <li className="flex gap-2.5">
                        <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
                        If the provider misses a heartbeat the lease can be terminated, its bond is slashed to you, and unused escrow is refunded.
                      </li>
                    </ul>

                    {failure && <ErrorNote>{failure}</ErrorNote>}

                    <div>
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setStep(1)}>
                          Back
                        </Button>
                        <Button
                          variant="primary"
                          className="flex-1"
                          icon={address ? "gpu" : "wallet"}
                          loading={connecting}
                          disabled={!!address && (!enoughBalance || !deploymentReady)}
                          onClick={handleRequest}
                        >
                          {!address ? "Connect wallet" : `Request lease · ${fmtSmesh(escrow)}`}
                        </Button>
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-faint">
                        {!address
                          ? "Connect the wallet that will fund the escrow."
                          : !deploymentReady
                            ? "Contract addresses are not available yet. Check the orchestrator connection."
                            : !enoughBalance
                              ? `Your wallet holds ${fmtSmesh(balanceWei)}, less than the escrow.`
                              : "Your wallet asks you to approve the escrow, then to submit the request."}
                      </p>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="mt-6 space-y-5">
                    <Progress phase={phase} />
                    <p role="status" aria-live="polite" className="text-[13px] leading-relaxed text-ink2">
                      {phase === "approve" && "Approve the escrow spend in your wallet."}
                      {phase === "request" && "Approval confirmed. Submit the lease request in your wallet."}
                      {phase === "confirm" && "Request submitted. Waiting for confirmation on chain."}
                      {phase === "done" && <span className="text-success">{notice}</span>}
                    </p>
                    {txHash && (
                      <p className="mono break-all text-[12px] text-faint" title={txHash}>
                        {txHash}
                      </p>
                    )}
                    {failure && <ErrorNote>{failure}</ErrorNote>}
                    {phase === "done" && (
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href="/leases"
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-accent bg-accent px-3.5 text-[13px] font-medium text-accent-ink transition-colors duration-fast ease-out hover:border-accent-hover hover:bg-accent-hover"
                        >
                          Go to My leases
                          <Icon name="arrow" className="h-4 w-4" aria-hidden />
                        </Link>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setStep(1);
                            setPhase(null);
                            setTxHash(null);
                            setNotice(null);
                          }}
                        >
                          Rent another
                        </Button>
                      </div>
                    )}
                    {phase === "error" && (
                      <Button variant="secondary" onClick={() => setStep(2)}>
                        Back to review
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ListingCard({
  listing,
  provider,
  selected,
  disabled,
  onSelect,
}: {
  listing: Listing;
  provider?: Provider;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const leased = !listing.available;
  const passed = provider?.challengesPassed;
  const failed = provider?.challengesFailed;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={leased || disabled}
      aria-pressed={selected}
      aria-label={`${listing.gpu || `Listing ${listing.id}`}, ${fmtAmount(pricePerHour(listing))} SMESH per hour${leased ? ", leased" : ""}`}
      className={`flex h-full w-full flex-col rounded-lg border bg-surface p-5 text-left transition-colors duration-fast ease-out disabled:cursor-not-allowed ${
        selected
          ? "border-accent ring-1 ring-inset ring-accent"
          : "border-line hover:border-line-strong hover:bg-hover"
      } ${leased ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink">
            {listing.gpu || "Compute"}
          </div>
          <div className="mt-1 text-[13px] text-muted">
            {listing.vramGB ? `${listing.vramGB} GB VRAM` : "CPU only"}
            {listing.region ? `, ${listing.region}` : ""}
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium ${
            leased ? "text-muted" : "text-success"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${leased ? "bg-faint" : "bg-success"}`} aria-hidden />
          {leased ? "Leased" : "Available"}
        </span>
      </div>

      {listing.models.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Served models">
          {listing.models.map((m) => (
            <li key={m} className="mono rounded-[4px] border border-line bg-panel px-1.5 py-0.5 text-[12px] text-ink2">
              {m}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="mono text-[24px] font-semibold leading-none tracking-tight text-ink">
          {fmtAmount(pricePerHour(listing))}
        </span>
        <span className="text-[13px] text-muted">SMESH / hour</span>
      </div>
      <div className="mt-1.5 text-[12px] text-faint">
        <span className="mono">{fmtSmesh(listing.pricePerInterval)}</span> per{" "}
        <span className="mono">{fmtInterval(listing.intervalSecs)}</span> interval, lease{" "}
        <span className="mono">{listing.minIntervals}</span> to <span className="mono">{listing.maxIntervals}</span>
      </div>

      <div className="mt-auto pt-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-[12px] text-muted">
          <span className="mono">{shortAddr(listing.provider)}</span>
          <RepBar score={provider ? repScore(provider.reputation) : 50} />
        </div>
        {passed !== undefined && (
          <div className="mt-1.5 text-[12px] text-faint">
            Benchmark challenges: <span className="mono text-ink2">{passed}</span> passed,{" "}
            <span className={`mono ${failed ? "text-danger" : "text-ink2"}`}>{failed ?? 0}</span> failed
          </div>
        )}
      </div>
    </button>
  );
}

function Row({ label, children, mono = true }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={`min-w-0 text-right text-ink2 ${mono ? "mono" : ""}`}>{children}</dd>
    </div>
  );
}

const STEPS = ["Configure", "Review", "Confirm"] as const;

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Lease steps">
      {STEPS.map((label, i) => {
        const n = (i + 1) as Step;
        const state = n < step ? "done" : n === step ? "current" : "upcoming";
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className={`flex items-center gap-2 ${i < STEPS.length - 1 ? "min-w-0 flex-1" : "shrink-0"}`}
          >
            <span
              className={`mono grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[12px] font-semibold ${
                state === "done"
                  ? "border-success bg-success text-surface"
                  : state === "current"
                    ? "border-accent bg-accent-weak text-accent"
                    : "border-line-strong text-faint"
              }`}
            >
              {state === "done" ? <Icon name="check" className="h-3.5 w-3.5" aria-hidden /> : n}
            </span>
            <span className={`shrink-0 text-[13px] font-medium ${state === "upcoming" ? "text-faint" : "text-ink"}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px min-w-2 flex-1 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

const PROGRESS: { phase: Phase; label: string }[] = [
  { phase: "approve", label: "Approve escrow spend" },
  { phase: "request", label: "Submit lease request" },
  { phase: "confirm", label: "Confirm on chain" },
];

function Progress({ phase }: { phase: Phase | null }) {
  const order: Phase[] = ["approve", "request", "confirm", "done"];
  const reached = phase === "error" ? -1 : order.indexOf(phase ?? "approve");
  return (
    <ol className="space-y-2.5 text-[13px]">
      {PROGRESS.map((item, i) => {
        const done = reached > i;
        const active = reached === i;
        return (
          <li key={item.phase} className="flex items-center gap-2.5">
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                done ? "border-success bg-success text-surface" : active ? "border-accent" : "border-line-strong"
              }`}
              aria-hidden
            >
              {done ? (
                <Icon name="check" className="h-3 w-3" />
              ) : active ? (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
              ) : null}
            </span>
            <span className={done || active ? "text-ink" : "text-faint"}>
              {item.label}
              <span className="sr-only">{done ? ", done" : active ? ", in progress" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
