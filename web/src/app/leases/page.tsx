"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import {
  Button,
  Card,
  CardHead,
  Empty,
  ErrorNote,
  GpuChip,
  Heartbeats,
  Skeleton,
  StatusTag,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { fmtUsd, shortAddr } from "@/lib/format";
import { cancelLease, endLease, settleLease } from "@/lib/actions";
import type { Deployment, Lease, Listing } from "@/lib/types";

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

  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const mine = address
    ? [...leases]
        .filter((lease) => lease.requester.toLowerCase() === address.toLowerCase())
        .sort((a, b) => b.id - a.id)
    : [];

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
                  <Th>Provider</Th>
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

                      <Td className="mono text-muted">{shortAddr(lease.provider)}</Td>

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
    </div>
  );
}
