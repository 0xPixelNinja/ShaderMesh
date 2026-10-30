"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { api, useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import {
  Button,
  Empty,
  ErrorNote,
  GpuChip,
  PageHeader,
  Section,
  Skeleton,
  StatusTag,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { EscrowIntervals, HeartbeatStrip, LeaseLifecycle } from "@/components/diagrams";
import { fmtInterval, fmtSmesh, shortAddr } from "@/lib/format";
import { cancelLease, endLease, settleLease } from "@/lib/actions";
import type { Deployment, Lease, LeaseAccess, Listing } from "@/lib/types";
import { copyText } from "@/lib/browser";

type Kind = "cancel" | "settle" | "end";

function fmtTimestamp(timestamp: number): string {
  if (!timestamp) return "Not started";
  return new Date(timestamp * 1000).toLocaleString();
}

/** Intervals elapsed since the lease started, capped at the funded count. */
function elapsedIntervals(lease: Lease): number {
  if (!lease.start || !lease.intervalSecs) return 0;
  const passed = Math.floor((Date.now() / 1000 - lease.start) / lease.intervalSecs);
  return Math.max(0, Math.min(lease.fundedIntervals, passed));
}

/** Time left on the funded intervals, for example "14m left". */
function timeLeft(lease: Lease): string {
  if (!lease.start) return "-";
  const secs = lease.start + lease.fundedIntervals * lease.intervalSecs - Date.now() / 1000;
  if (secs <= 0) return "Funded time used";
  if (secs >= 86400) return `${(secs / 86400).toFixed(1)}d left`;
  if (secs >= 3600) return `${(secs / 3600).toFixed(1)}h left`;
  if (secs >= 60) return `${Math.floor(secs / 60)}m left`;
  return `${Math.floor(secs)}s left`;
}

function mul(price: string, n: number): string {
  return (BigInt(price) * BigInt(n)).toString();
}

export default function LeasesPage() {
  const { address, connect, connecting } = useWallet();
  const leasesState = useApi<Lease[]>("/leases", 4000);
  const listingsState = useApi<Listing[]>("/listings?all=true", 30000);
  const deploymentState = useApi<Deployment>("/deployment", 30000);
  const leases = leasesState.data ?? [];
  const listings = listingsState.data ?? [];
  const deployment = deploymentState.data;
  const [msg, setMsg] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [access, setAccess] = useState<Record<number, LeaseAccess>>({});
  const [accessError, setAccessError] = useState<Record<number, string>>({});

  async function loadAccess(leaseId: number) {
    setPending(`access-${leaseId}`);
    setAccessError((current) => ({ ...current, [leaseId]: "" }));
    try {
      const details = await api.get<LeaseAccess>(`/leases/${leaseId}/access`);
      setAccess((current) => ({ ...current, [leaseId]: details }));
    } catch {
      setAccessError((current) => ({
        ...current,
        [leaseId]:
          "Connection details are not available yet. The provider publishes them once the workload is running.",
      }));
    } finally {
      setPending(null);
    }
  }

  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const mine = address
    ? [...leases]
        .filter((lease) => lease.requester.toLowerCase() === address.toLowerCase())
        .sort((a, b) => b.id - a.id)
    : [];
  const activeLeases = mine.filter((lease) => lease.status === "Active");
  const pendingLeases = mine.filter((lease) => lease.status === "Pending");
  const pastLeases = mine.filter((lease) => lease.status !== "Active" && lease.status !== "Pending");

  async function act(kind: Kind, lease: Lease) {
    if (!address) return;
    setConfirming(null);
    if (!deployment?.contracts?.RentalMarket) {
      setFailure("Deployment is not available yet. Check the orchestrator connection.");
      return;
    }

    setMsg(null);
    setFailure(null);
    setPending(`${kind}-${lease.id}`);
    try {
      if (kind === "cancel") await cancelLease(address, deployment.contracts.RentalMarket, lease.id);
      if (kind === "settle") await settleLease(address, deployment.contracts.RentalMarket, lease.id);
      if (kind === "end") await endLease(address, deployment.contracts.RentalMarket, lease.id);
      const verb = kind === "cancel" ? "Cancellation" : kind === "settle" ? "Settlement" : "End";
      setMsg(`${verb} transaction submitted for lease #${lease.id}.`);
    } catch (error) {
      setFailure("Action failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPending(null);
    }
  }

  const header = (
    <PageHeader
      eyebrow="Rent"
      title="My leases"
      description="Leases funded by your wallet. Escrow settles only for intervals the provider proves with a signed heartbeat."
    />
  );

  if (!address) {
    return (
      <div>
        {header}
        <div className="rounded-lg border border-line bg-surface">
          <Empty
            icon="wallet"
            title="Connect your wallet to see your leases"
            hint="A lease belongs to the account that funded its escrow, so the dashboard needs to know which account is yours."
            action={
              <Button variant="primary" icon="wallet" onClick={connect} loading={connecting}>
                Connect wallet
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const apiError = leasesState.error ?? listingsState.error ?? deploymentState.error;
  const busy = pending !== null;
  const gpuOf = (lease: Lease) => listingById.get(lease.listingId)?.gpu || `Listing #${lease.listingId}`;

  return (
    <div>
      {header}

      <div role="status" aria-live="polite" className="empty:hidden mb-6">
        {msg && (
          <div className="rounded-lg border border-success bg-success-weak px-4 py-3 text-[13px] text-success">{msg}</div>
        )}
      </div>
      {(failure || apiError) && (
        <div className="mb-6 space-y-3">
          {failure && <ErrorNote>{failure}</ErrorNote>}
          {apiError && <ErrorNote>Some lease data could not be loaded. {apiError}</ErrorNote>}
        </div>
      )}

      {leasesState.loading ? (
        <Skeleton label="Loading leases" rows={3} />
      ) : leasesState.error ? (
        <Empty icon="alert" title="Leases could not be loaded" hint="Check the orchestrator connection and try again." />
      ) : mine.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <Empty
            icon="gpu"
            title="No lease requests yet"
            hint="Request a GPU from the marketplace. Your escrow is deposited immediately, but the lease clock only starts when the provider accepts."
            action={
              <Link
                href="/rent"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-accent bg-accent px-3.5 text-[13px] font-medium text-accent-ink transition-colors duration-fast ease-out hover:border-accent-hover hover:bg-accent-hover"
              >
                Browse the marketplace
              </Link>
            }
          />
        </div>
      ) : (
        <div className="space-y-12">
          <Section
            title="Active leases"
            description="The provider bonds stake on accept, runs your workload in a sandboxed container, and signs a heartbeat every interval."
          >
            {activeLeases.length === 0 ? (
              <p className="text-[13px] text-muted">No lease is running right now.</p>
            ) : (
              <div className="space-y-6">
                {activeLeases.map((lease) => (
                  <ActiveLeaseCard
                    key={lease.id}
                    lease={lease}
                    listing={listingById.get(lease.listingId)}
                    access={access[lease.id]}
                    accessError={accessError[lease.id]}
                    pending={pending}
                    busy={busy}
                    confirming={confirming === `end-${lease.id}`}
                    onAccess={() => loadAccess(lease.id)}
                    onSettle={() => act("settle", lease)}
                    onAskEnd={() => setConfirming(`end-${lease.id}`)}
                    onKeep={() => setConfirming(null)}
                    onEnd={() => act("end", lease)}
                  />
                ))}
              </div>
            )}
          </Section>

          {pendingLeases.length > 0 && (
            <Section
              title="Pending requests"
              description="The provider agent accepts automatically, usually within seconds. Until then no bond is locked and the clock has not started."
            >
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {pendingLeases.map((lease) => {
                  const isConfirming = confirming === `cancel-${lease.id}`;
                  return (
                    <li key={lease.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                      <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-0 sm:flex-1">
                        <GpuChip />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{gpuOf(lease)}</div>
                          <div className="mono text-[12px] text-faint">
                            lease #{lease.id}, {shortAddr(lease.provider)}
                          </div>
                        </div>
                      </div>
                      <div className="text-[13px]">
                        <div className="mono text-ink">{fmtSmesh(lease.escrow)}</div>
                        <div className="text-[12px] text-faint">
                          in escrow, {lease.fundedIntervals} x {fmtInterval(lease.intervalSecs)}
                        </div>
                      </div>
                      <StatusTag status={lease.status} />
                      <div className="flex items-center gap-2">
                        {isConfirming ? (
                          <>
                            <span className="text-[12px] text-muted">Refund {fmtSmesh(lease.escrow)}?</span>
                            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                              Keep
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => act("cancel", lease)}
                              loading={pending === `cancel-${lease.id}`}
                              disabled={busy}
                            >
                              Confirm cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setConfirming(`cancel-${lease.id}`)}
                            loading={pending === `cancel-${lease.id}`}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          <Section title="History" description="Ended, terminated, rejected, and cancelled leases.">
            {pastLeases.length === 0 ? (
              <p className="text-[13px] text-muted">No finished leases yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line bg-surface">
                <table className="w-full min-w-[680px] border-collapse">
                  <caption className="sr-only">Finished leases, newest first</caption>
                  <thead>
                    <tr>
                      <Th>Lease</Th>
                      <Th>GPU</Th>
                      <Th>Provider</Th>
                      <Th align="right">Intervals served</Th>
                      <Th align="right">Paid</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastLeases.map((lease) => (
                      <Tr key={lease.id}>
                        <Td className="mono whitespace-nowrap text-ink2">
                          lease #{lease.id}
                          <div className="text-[12px] text-faint">{fmtTimestamp(lease.start)}</div>
                        </Td>
                        <Td className="whitespace-nowrap text-ink">{gpuOf(lease)}</Td>
                        <Td className="mono whitespace-nowrap text-muted">{shortAddr(lease.provider)}</Td>
                        <Td align="right" className="mono text-ink2">
                          {lease.settledIntervals} / {lease.fundedIntervals}
                        </Td>
                        <Td align="right" className="mono text-ink">
                          {fmtSmesh(mul(lease.pricePerInterval, lease.settledIntervals))}
                        </Td>
                        <Td>
                          <StatusTag status={lease.status} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function ActiveLeaseCard({
  lease,
  listing,
  access,
  accessError,
  pending,
  busy,
  confirming,
  onAccess,
  onSettle,
  onAskEnd,
  onKeep,
  onEnd,
}: {
  lease: Lease;
  listing?: Listing;
  access?: LeaseAccess;
  accessError?: string;
  pending: string | null;
  busy: boolean;
  confirming: boolean;
  onAccess: () => void;
  onSettle: () => void;
  onAskEnd: () => void;
  onKeep: () => void;
  onEnd: () => void;
}) {
  const funded = mul(lease.pricePerInterval, lease.fundedIntervals);
  const spent = mul(lease.pricePerInterval, lease.settledIntervals);
  const unsettled = Math.max(lease.heartbeatedIntervals - lease.settledIntervals, 0);
  const ssh = access ? `ssh ${access.username}@${access.host} -p ${access.port}` : "";

  return (
    <article
      aria-labelledby={`lease-${lease.id}-title`}
      className="rounded-lg border border-line bg-surface"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <GpuChip live />
          <div className="min-w-0">
            <h3 id={`lease-${lease.id}-title`} className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
              {listing?.gpu || `Listing #${lease.listingId}`}
            </h3>
            <div className="mono text-[12px] text-faint">
              lease #{lease.id}, {shortAddr(lease.provider)}
              {listing?.vramGB ? `, ${listing.vramGB} GB` : ""}
              {listing?.region ? `, ${listing.region}` : ""}
            </div>
          </div>
        </div>
        <StatusTag status={lease.status} />
      </header>

      <div className="space-y-8 p-5">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Fact label="Settled so far" value={fmtSmesh(spent)} sub={`of ${fmtSmesh(funded)} funded`} />
          <Fact label="Escrow remaining" value={fmtSmesh(lease.escrow)} sub={`${unsettled} interval${unsettled === 1 ? "" : "s"} unsettled`} />
          <Fact label="Time left" value={timeLeft(lease)} sub={`started ${fmtTimestamp(lease.start)}`} />
          <Fact
            label="Heartbeats"
            value={`${lease.heartbeatedIntervals} / ${lease.fundedIntervals}`}
            sub={`one every ${fmtInterval(lease.intervalSecs)}`}
          />
        </dl>

        <section aria-label="Lease evidence">
          <h4 className="mb-4 text-[13px] font-medium text-ink2">Lease evidence</h4>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-3 text-[12px] text-muted">Signed heartbeats</div>
              <HeartbeatStrip elapsed={elapsedIntervals(lease)} beats={lease.heartbeatedIntervals} live />
            </div>
            <div className="min-w-0">
              <div className="mb-3 text-[12px] text-muted">Escrow intervals</div>
              <EscrowIntervals
                funded={lease.fundedIntervals}
                heartbeated={lease.heartbeatedIntervals}
                settled={lease.settledIntervals}
                max={lease.maxIntervals}
              />
            </div>
          </div>
          <details className="group mt-6">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-[12px] font-medium text-muted transition-colors duration-fast ease-out hover:text-ink">
              Lifecycle
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform duration-fast ease-out group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <div className="mt-3 max-w-[560px]">
              <LeaseLifecycle status={lease.status} />
            </div>
          </details>
        </section>

        <section aria-label="Connect to your GPU" className="border-t border-line pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-[13px] font-medium text-ink2">Connect to your GPU</h4>
              <p className="mt-0.5 text-[12px] text-faint">Shell access to the container your escrow is paying for.</p>
            </div>
            {!access && (
              <Button
                variant="primary"
                icon="shield"
                onClick={onAccess}
                loading={pending === `access-${lease.id}`}
              >
                Get connection details
              </Button>
            )}
          </div>

          {accessError && (
            <div className="mt-3">
              <ErrorNote>{accessError}</ErrorNote>
            </div>
          )}

          {access && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2.5">
                <code className="mono min-w-0 flex-1 break-all text-[13px] text-ink">{ssh}</code>
                <CopyButton value={ssh} label="ssh command" />
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                {[
                  ["Host", access.host],
                  ["Port", String(access.port)],
                  ["Username", access.username],
                  ["Password", access.password],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[12px] text-faint">{label}</dt>
                    <dd className="mono mt-0.5 truncate text-[13px] text-ink" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-[12px] leading-relaxed text-faint">
                Access lasts as long as the lease. When it ends or is terminated the provider stops the container and
                this credential stops working. On this devnet the provider returns the credential to any caller that can
                reach it; a public deployment must require a signature from the lease holder.
              </p>
            </div>
          )}
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        {confirming ? (
          <>
            <span className="mr-auto text-[13px] text-ink2">
              End lease #{lease.id}? Heartbeated intervals are paid and the rest of the escrow is refunded to you.
            </span>
            <Button size="sm" variant="ghost" onClick={onKeep}>
              Keep running
            </Button>
            <Button size="sm" variant="danger" onClick={onEnd} loading={pending === `end-${lease.id}`} disabled={busy}>
              Confirm end
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto text-[12px] text-faint">
              Settle pays the provider for proven intervals. End also refunds the rest.
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={onSettle}
              loading={pending === `settle-${lease.id}`}
              disabled={busy}
            >
              Settle
            </Button>
            <Button size="sm" variant="secondary" onClick={onAskEnd} loading={pending === `end-${lease.id}`} disabled={busy}>
              End
            </Button>
          </>
        )}
      </footer>
    </article>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mono mt-1 truncate text-[16px] font-semibold text-ink">{value}</dd>
      {sub && <dd className="mt-0.5 truncate text-[12px] text-faint">{sub}</dd>}
    </div>
  );
}

/** Copies a full value (the shared CopyValue shortens what it shows). */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const ok = await copyText(value);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-transparent text-faint transition-colors duration-fast ease-out hover:border-line hover:bg-hover hover:text-ink"
    >
      <Icon name={copied ? "check" : "copy"} className={`h-3.5 w-3.5 ${copied ? "text-success" : ""}`} aria-hidden />
    </button>
  );
}
