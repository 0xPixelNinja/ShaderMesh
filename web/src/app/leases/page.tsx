"use client";

import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import {
  Button,
  Card,
  CardHead,
  CopyValue,
  Empty,
  ErrorNote,
  GpuChip,
  Heartbeats,
  Note,
  Skeleton,
  StatusTag,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { fmtUsd, shortAddr } from "@/lib/format";
import { cancelLease, endLease, settleLease } from "@/lib/actions";
import type { Deployment, Lease, LeaseAccess, Listing } from "@/lib/types";

function fmtTimestamp(timestamp: number): string {
  if (!timestamp) return "Not started";
  return new Date(timestamp * 1000).toLocaleString();
}

/** Share of funded intervals already settled, as a percentage. */
function settledPct(lease: Lease): number {
  if (!lease.fundedIntervals) return 0;
  return Math.min(100, (lease.settledIntervals / lease.fundedIntervals) * 100);
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

  async function act(kind: "cancel" | "settle" | "end", lease: Lease) {
    if (!address) return;
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

  if (!address) {
    return (
      <div className="mx-auto max-w-lg">
        <Card>
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
        </Card>
      </div>
    );
  }

  const apiError = leasesState.error ?? listingsState.error ?? deploymentState.error;

  return (
    <div className="space-y-4">
      {msg && (
        <div
          role="status"
          className="rounded-lg border border-success/30 bg-success-weak px-4 py-3 text-[13px] text-success"
        >
          {msg}
        </div>
      )}
      {failure && <ErrorNote>{failure}</ErrorNote>}
      {apiError && <ErrorNote>Some lease data could not be loaded. {apiError}</ErrorNote>}

      <Note>
        A lease request is accepted by the provider&apos;s agent automatically, normally within seconds;
        there is no manual approval. Once accepted the provider bonds stake, starts your workload in a
        sandboxed container on its GPU, and must publish a signed heartbeat every interval. Escrow
        settles only for intervals it proved it served.
      </Note>

      <Card>
        <CardHead
          title="My leases"
          sub={`${mine.length} request${mine.length === 1 ? "" : "s"}, newest first`}
        />
        {leasesState.loading ? (
          <Skeleton label="Loading leases" rows={3} />
        ) : leasesState.error ? (
          <Empty
            icon="alert"
            title="Leases could not be loaded"
            hint="Check the orchestrator connection and try again."
          />
        ) : mine.length === 0 ? (
          <Empty
            icon="gpu"
            title="No lease requests yet"
            hint="Request a GPU from the marketplace. Your escrow is deposited immediately, but the lease clock only starts when the provider accepts."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <Th>GPU</Th>
                  <Th>Hardware you leased</Th>
                  <Th>Uptime</Th>
                  <Th align="right">Streamed</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {mine.map((lease) => {
                  const listing = listingById.get(lease.listingId);
                  const gpu = listing?.gpu || `Listing #${lease.listingId}`;
                  const isPending = lease.status === "Pending";
                  const isActive = lease.status === "Active";
                  const streamed = (
                    BigInt(lease.pricePerInterval) * BigInt(lease.settledIntervals)
                  ).toString();
                  const busy = pending !== null;

                  return (
                    <Tr key={lease.id}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <GpuChip live={isActive} />
                          <div className="min-w-0">
                            <div className="font-medium text-ink">{gpu}</div>
                            <div className="mono truncate text-[12px] text-faint">
                              lease #{lease.id} · {fmtTimestamp(lease.start)}
                            </div>
                          </div>
                        </div>
                      </Td>

                      <Td>
                        {listing ? (
                          <>
                            <div className="text-[13px] text-ink2">
                              {listing.vramGB ? `${listing.vramGB} GB VRAM` : "CPU only"}
                              {listing.region ? ` · ${listing.region}` : ""}
                            </div>
                            <div className="mono text-[12px] text-faint">
                              {shortAddr(lease.provider)}
                            </div>
                          </>
                        ) : (
                          <span className="mono text-[13px] text-muted">
                            {shortAddr(lease.provider)}
                          </span>
                        )}
                      </Td>

                      <Td>
                        {isPending ? (
                          <span className="text-[13px] text-muted">
                            Awaiting provider acceptance
                          </span>
                        ) : (
                          <div className="space-y-1.5">
                            <Heartbeats
                              up={lease.heartbeatedIntervals}
                              total={Math.min(Math.max(lease.fundedIntervals, 1), 10)}
                              live={isActive}
                            />
                            <div className="mono text-[12px] text-faint">
                              {lease.settledIntervals} settled · {lease.heartbeatedIntervals}/
                              {lease.fundedIntervals} beats
                            </div>
                          </div>
                        )}
                      </Td>

                      <Td align="right">
                        <div className="mono font-medium text-ink">{fmtUsd(streamed)}</div>
                        <div className="mono text-[12px] text-faint">
                          {fmtUsd(lease.escrow)} left
                        </div>
                        {!isPending && (
                          <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-panel">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${settledPct(lease)}%` }}
                            />
                          </span>
                        )}
                      </Td>

                      <Td>
                        <StatusTag status={lease.status} />
                        {isPending && lease.bond === "0" && (
                          <div className="mt-1 text-[12px] text-faint">No bond locked yet</div>
                        )}
                      </Td>

                      <Td align="right">
                        {isPending ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => act("cancel", lease)}
                            loading={pending === `cancel-${lease.id}`}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                        ) : isActive ? (
                          <span className="inline-flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => act("settle", lease)}
                              loading={pending === `settle-${lease.id}`}
                              disabled={busy}
                            >
                              Settle
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => act("end", lease)}
                              loading={pending === `end-${lease.id}`}
                              disabled={busy}
                            >
                              End
                            </Button>
                          </span>
                        ) : (
                          <span className="text-[13px] text-faint">No actions</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

      {activeLeases.length > 0 && (
        <Card>
          <CardHead
            title="Connect to your GPU"
            sub="Shell access to the container your escrow is paying for"
          />
          <div className="rule">
            {activeLeases.map((lease) => {
              const listing = listingById.get(lease.listingId);
              const details = access[lease.id];
              const error = accessError[lease.id];
              return (
                <div key={lease.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <GpuChip live />
                      <div>
                        <div className="font-medium text-ink">
                          {listing?.gpu || `Listing #${lease.listingId}`}
                        </div>
                        <div className="mono text-[12px] text-faint">lease #{lease.id}</div>
                      </div>
                    </div>
                    {!details && (
                      <Button
                        variant="primary"
                        icon="shield"
                        onClick={() => loadAccess(lease.id)}
                        loading={pending === `access-${lease.id}`}
                      >
                        Get connection details
                      </Button>
                    )}
                  </div>

                  {error && (
                    <div className="mt-3">
                      <ErrorNote>{error}</ErrorNote>
                    </div>
                  )}

                  {details && (
                    <div className="mt-4 space-y-3">
                      <div>
                        <div className="mb-1.5 text-[13px] font-medium text-ink2">
                          SSH command
                        </div>
                        <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2.5">
                          <code className="mono min-w-0 flex-1 truncate text-[13px] text-ink">
                            ssh {details.username}@{details.host} -p {details.port}
                          </code>
                          <CopyValue
                            value={`ssh ${details.username}@${details.host} -p ${details.port}`}
                            label="ssh command"
                          />
                        </div>
                      </div>

                      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
                        {[
                          ["Host", details.host],
                          ["Port", String(details.port)],
                          ["Username", details.username],
                          ["Password", details.password],
                        ].map(([label, value]) => (
                          <div key={label} className="bg-panel px-3 py-2.5">
                            <dt className="text-[12px] text-faint">{label}</dt>
                            <dd className="mono mt-0.5 truncate text-[13px] text-ink" title={value}>
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>

                      <Note tone="accent">
                        Access lasts as long as the lease. When it ends or is terminated the provider
                        stops the container and this credential stops working. On this devnet the
                        provider returns the credential to any caller that can reach it; a public
                        deployment must require a signature from the lease holder.
                      </Note>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
