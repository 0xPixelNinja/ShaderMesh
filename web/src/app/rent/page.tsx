"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { Card, CardHead, GpuChip, Empty, RepBar } from "@/components/ui";
import { fmtUsd, shortAddr, repScore, fmtInterval } from "@/lib/format";
import { rentGpu } from "@/lib/actions";
import type { Deployment, Listing, Provider } from "@/lib/types";

function pricePerHour(l: Listing): number {
  const perInterval = Number(l.pricePerInterval) / 1e18;
  return l.intervalSecs ? perInterval * (3600 / l.intervalSecs) : perInterval;
}

export default function RentPage() {
  const { address, connect } = useWallet();
  const listings = useApi<Listing[]>("/listings").data ?? [];
  const providers = useApi<Provider[]>("/providers").data ?? [];
  const deployment = useApi<Deployment>("/deployment", 30000).data;

  const repByAddr = new Map(providers.map((p) => [p.address.toLowerCase(), p]));
  const [pending, setPending] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleRent(l: Listing) {
    setMsg(null);
    if (!address) {
      await connect();
      return;
    }
    if (!deployment?.contracts?.RentalMarket) {
      setMsg("Deployment not available yet.");
      return;
    }
    const intervals = Math.max(l.minIntervals, Math.min(l.maxIntervals, 24));
    setPending(l.id);
    try {
      await rentGpu({
        account: address,
        token: deployment.contracts.SmeshToken,
        rental: deployment.contracts.RentalMarket,
        listingId: l.id,
        pricePerInterval: l.pricePerInterval,
        intervals,
      });
      setMsg(`Leased ${l.gpu} for ${intervals} intervals. See My leases.`);
    } catch (e) {
      setMsg("Rent failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      {msg && (
        <div className="mb-4 rounded-md border border-line bg-panel px-4 py-2.5 text-sm text-ink2">{msg}</div>
      )}
      <Card>
        <CardHead title="Available GPUs" sub={`${listings.filter((l) => l.active).length} offers`} />
        {listings.filter((l) => l.active).length === 0 ? (
          <Empty title="No GPUs listed yet" hint="Start a provider agent to list capacity" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="border-b border-line px-4 py-2.5 font-medium">GPU</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Provider</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Price</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Interval</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium">Reputation</th>
                  <th className="border-b border-line px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {listings
                  .filter((l) => l.active)
                  .map((l) => {
                    const prov = repByAddr.get(l.provider.toLowerCase());
                    return (
                      <tr key={l.id} className="text-[13px] hover:bg-hover">
                        <td className="border-b border-line px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <GpuChip />
                            <div>
                              <b className="font-medium">{l.gpu || "Compute"}</b>
                              <small className="mono block text-[11px] text-faint">
                                {l.vramGB ? `${l.vramGB} GB · ` : ""}
                                {l.region || "local"}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td className="mono border-b border-line px-4 py-3 text-xs text-muted">{shortAddr(l.provider)}</td>
                        <td className="mono border-b border-line px-4 py-3">
                          <b className="font-semibold">${pricePerHour(l).toFixed(2)}</b>
                          <span className="text-faint"> /hr</span>
                        </td>
                        <td className="mono border-b border-line px-4 py-3 text-muted">{fmtInterval(l.intervalSecs)}</td>
                        <td className="border-b border-line px-4 py-3">
                          <RepBar score={prov ? repScore(prov.reputation) : 50} />
                        </td>
                        <td className="border-b border-line px-4 py-3 text-right">
                          <button
                            onClick={() => handleRent(l)}
                            disabled={pending === l.id}
                            className="rounded-md border border-accent bg-accent px-3.5 py-1.5 text-xs font-semibold text-[#1A1205] hover:bg-accent-hover disabled:opacity-60"
                          >
                            {pending === l.id ? "Renting…" : "Rent"}
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
        Prices in USD at 1 SMESH = $1. Escrow streams to the provider per verified interval; unused time is refundable and downtime is slashed.
      </p>
    </div>
  );
}
