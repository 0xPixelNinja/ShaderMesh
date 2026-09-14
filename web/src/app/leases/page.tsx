"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { Card, CardHead, GpuChip, StatusTag, Empty } from "@/components/ui";
import { fmtUsd, shortAddr } from "@/lib/format";
import { endLease, settleLease } from "@/lib/actions";
import type { Deployment, Lease, Listing } from "@/lib/types";

export default function LeasesPage() {
  const { address, connect } = useWallet();
  const leases = useApi<Lease[]>("/leases").data ?? [];
  const listings = useApi<Listing[]>("/listings", 30000).data ?? [];
  const deployment = useApi<Deployment>("/deployment", 30000).data;
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const listingById = new Map(listings.map((l) => [l.id, l]));
  const mine = address ? leases.filter((l) => l.requester.toLowerCase() === address.toLowerCase()) : [];

  async function act(kind: "settle" | "end", lease: Lease) {
    if (!address || !deployment?.contracts?.RentalMarket) return;
    setMsg(null);
    setPending(`${kind}-${lease.id}`);
    try {
      if (kind === "settle") await settleLease(address, deployment.contracts.RentalMarket, lease.id);
      else await endLease(address, deployment.contracts.RentalMarket, lease.id);
      setMsg(`${kind === "settle" ? "Settled" : "Ended"} lease #${lease.id}.`);
    } catch (e) {
      setMsg("Action failed: " + (e instanceof Error ? e.message : String(e)));
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

  return (
    <div>
      {msg && <div className="mb-4 rounded-md border border-line bg-panel px-4 py-2.5 text-sm text-ink2">{msg}</div>}
      <Card>
        <CardHead title="My leases" sub={`${mine.length} total`} />
        {mine.length === 0 ? (
          <Empty title="No leases yet" hint="Rent a GPU to open your first lease" />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="border-b border-line px-4 py-2.5 font-medium">GPU</th>
                <th className="border-b border-line px-4 py-2.5 font-medium">Provider</th>
                <th className="border-b border-line px-4 py-2.5 font-medium">Intervals</th>
                <th className="border-b border-line px-4 py-2.5 font-medium">Streamed</th>
                <th className="border-b border-line px-4 py-2.5 font-medium">Status</th>
                <th className="border-b border-line px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {mine.map((l) => {
                const gpu = listingById.get(l.listingId)?.gpu || "GPU";
                const streamed = (BigInt(l.pricePerInterval) * BigInt(l.settledIntervals)).toString();
                return (
                  <tr key={l.id} className="text-[13px] hover:bg-hover">
                    <td className="border-b border-line px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <GpuChip />
                        <b className="font-medium">{gpu}</b>
                      </div>
                    </td>
                    <td className="mono border-b border-line px-4 py-3 text-xs text-muted">{shortAddr(l.provider)}</td>
                    <td className="mono border-b border-line px-4 py-3 text-muted">{l.settledIntervals}/{l.fundedIntervals}</td>
                    <td className="mono border-b border-line px-4 py-3">{fmtUsd(streamed)}</td>
                    <td className="border-b border-line px-4 py-3"><StatusTag status={l.status} /></td>
                    <td className="border-b border-line px-4 py-3 text-right">
                      {l.status === "Active" ? (
                        <span className="inline-flex gap-2">
                          <button onClick={() => act("settle", l)} disabled={pending === `settle-${l.id}`} className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink2 hover:bg-hover hover:text-ink disabled:opacity-60">
                            {pending === `settle-${l.id}` ? "…" : "Settle"}
                          </button>
                          <button onClick={() => act("end", l)} disabled={pending === `end-${l.id}`} className="rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-[#1A1205] hover:bg-accent-hover disabled:opacity-60">
                            {pending === `end-${l.id}` ? "…" : "End"}
                          </button>
                        </span>
                      ) : (
                        <span className="mono text-xs text-faint">closed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
