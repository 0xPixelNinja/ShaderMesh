"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { Card, CardHead, GpuChip, StatusTag, Empty } from "@/components/ui";
import { fmtUsd, shortAddr } from "@/lib/format";
import { cancelLease, endLease, settleLease } from "@/lib/actions";
import { isContentAddressedManifest } from "@/lib/config";
import type { Deployment, Lease, Listing } from "@/lib/types";

function fmtTimestamp(timestamp: number): string {
  if (!timestamp) return "Not started";
  return new Date(timestamp * 1000).toLocaleString();
}

export default function LeasesPage() {
  const { address, connect } = useWallet();
  const leasesState = useApi<Lease[]>("/leases");
  const listingsState = useApi<Listing[]>("/listings?all=true", 30000);
  const deploymentState = useApi<Deployment>("/deployment", 30000);
  const leases = leasesState.data ?? [];
  const listings = listingsState.data ?? [];
  const deployment = deploymentState.data;
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const mine = address ? leases.filter((lease) => lease.requester.toLowerCase() === address.toLowerCase()) : [];

  async function act(kind: "cancel" | "settle" | "end", lease: Lease) {
    if (!address) return;
    if (!deployment?.contracts?.RentalMarket) {
      setMsg("Deployment not available yet.");
      return;
    }

    setMsg(null);
    setPending(`${kind}-${lease.id}`);
    try {
      if (kind === "cancel") await cancelLease(address, deployment.contracts.RentalMarket, lease.id);
      if (kind === "settle") await settleLease(address, deployment.contracts.RentalMarket, lease.id);
      if (kind === "end") await endLease(address, deployment.contracts.RentalMarket, lease.id);
      const verb = kind === "cancel" ? "Cancellation" : kind === "settle" ? "Settlement" : "End";
      setMsg(`${verb} transaction submitted for lease #${lease.id}.`);
    } catch (error) {
      setMsg("Action failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPending(null);
    }
  }

  if (!address) {
    return (
      <Card>
        <Empty title="Connect your wallet to see your leases" />
        <div className="px-4 pb-6 text-center">
          <button onClick={connect} className="rounded-md border border-accent bg-accent px-4 py-2 text-sm font-semibold text-[#1A1205] hover:bg-accent-hover">
            Connect wallet
          </button>
        </div>
      </Card>
    );
  }

  const apiError = leasesState.error ?? listingsState.error ?? deploymentState.error;

  return (
    <div>
      {msg && (
        <div role="status" className="mb-4 rounded-md border border-line bg-panel px-4 py-2.5 text-sm text-ink2">
          {msg}
        </div>
      )}
      {apiError && (
        <div role="alert" className="mb-4 rounded-md border border-danger/40 bg-panel px-4 py-2.5 text-sm text-danger">
          Some lease data could not be loaded. {apiError}
        </div>
      )}
      <Card>
        <CardHead title="My leases" sub={`${mine.length} total`} />
        {leasesState.loading ? (
          <div role="status" className="space-y-3 px-4 py-5" aria-label="Loading leases">
            {[0, 1, 2].map((row) => <div key={row} className="h-10 animate-pulse rounded-md bg-panel" />)}
          </div>
        ) : leasesState.error ? (
          <Empty title="Leases could not be loaded" hint="Check the orchestrator connection and try again" />
        ) : mine.length === 0 ? (
          <Empty title="No lease requests yet" hint="Request a GPU to start a lease" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] border-collapse">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="border-b border-line px-4 py-2.5 font-medium">GPU</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Provider</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Service</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Funds</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Started</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Status</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Manifest</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {mine.map((lease) => {
                  const gpu = listingById.get(lease.listingId)?.gpu || `Listing #${lease.listingId}`;
                  const isPending = lease.status === "Pending";
                  const isActive = lease.status === "Active";
                  const manifestIsLink = isContentAddressedManifest(lease.manifest);
                  return (
                    <tr key={lease.id} className="text-[13px] hover:bg-hover">
                      <td className="border-b border-line px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <GpuChip />
                          <div>
                            <b className="font-medium">{gpu}</b>
                            <small className="mono block text-[11px] text-faint">lease #{lease.id}</small>
                          </div>
                        </div>
                      </td>
                      <td className="mono border-b border-line px-4 py-3 text-xs text-muted">{shortAddr(lease.provider)}</td>
                      <td className="border-b border-line px-4 py-3">
                        {isPending ? (
                          <span className="mono text-xs text-muted">{lease.fundedIntervals} requested · {lease.maxIntervals} max</span>
                        ) : (
                          <>
                            <span className="mono text-xs text-ink2">{lease.settledIntervals} settled · {lease.heartbeatedIntervals} heartbeats · {lease.fundedIntervals} funded</span>
                            <small className="mono mt-1 block text-[11px] text-faint">
                              {lease.lastHeartbeatInterval === null ? "No heartbeat recorded" : `Last #${lease.lastHeartbeatInterval + 1} · ${fmtTimestamp(lease.lastHeartbeat)}`}
                            </small>
                          </>
                        )}
                      </td>
                      <td className="border-b border-line px-4 py-3">
                        <span className="mono block text-xs">{fmtUsd(lease.escrow)} escrow</span>
                        <small className="mono mt-1 block text-[11px] text-faint">
                          {lease.bond === "0" && isPending ? "Bond starts on acceptance" : `${fmtUsd(lease.bond)} bond`}
                        </small>
                      </td>
                      <td className="mono border-b border-line px-4 py-3 text-xs text-muted">{fmtTimestamp(lease.start)}</td>
                      <td className="border-b border-line px-4 py-3"><StatusTag status={lease.status} /></td>
                      <td className="border-b border-line px-4 py-3">
                        {manifestIsLink ? (
                          <a href={lease.manifest} className="mono text-xs text-accent hover:text-accent-hover hover:underline" title={lease.manifest}>
                            {lease.manifest.length > 28 ? `${lease.manifest.slice(0, 25)}…` : lease.manifest}
                          </a>
                        ) : (
                          <span className="mono text-xs text-faint" title={lease.manifest}>{lease.manifest || "Not provided"}</span>
                        )}
                      </td>
                      <td className="border-b border-line px-4 py-3 text-right">
                        {isPending ? (
                          <button
                            onClick={() => act("cancel", lease)}
                            disabled={pending !== null}
                            className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink2 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {pending === `cancel-${lease.id}` ? "Cancelling…" : "Cancel request"}
                          </button>
                        ) : isActive ? (
                          <span className="inline-flex gap-2">
                            <button
                              onClick={() => act("settle", lease)}
                              disabled={pending !== null}
                              className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink2 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {pending === `settle-${lease.id}` ? "Settling…" : "Settle"}
                            </button>
                            <button
                              onClick={() => act("end", lease)}
                              disabled={pending !== null}
                              className="rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-[#1A1205] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {pending === `end-${lease.id}` ? "Ending…" : "End"}
                            </button>
                          </span>
                        ) : (
                          <span className="mono text-xs text-faint">No actions</span>
                        )}
                      </td>
                    </tr>
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
