"use client";

import Link from "next/link";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { Card, CardHead, GpuChip, StatusTag, Heartbeats, Empty, RepBar } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtUsd, shortAddr, repScore } from "@/lib/format";
import type { Lease, Listing, Provider } from "@/lib/types";

export default function OverviewPage() {
  const { address } = useWallet();
  const listings = useApi<Listing[]>("/listings?all=true").data ?? [];
  const leases = useApi<Lease[]>("/leases").data ?? [];
  const providers = useApi<Provider[]>("/providers").data ?? [];

  const listingById = new Map(listings.map((l) => [l.id, l]));
  const active = leases.filter((l) => l.status === "Active");
  const mine = address ? active.filter((l) => l.requester.toLowerCase() === address.toLowerCase()) : active;

  const streamingPerHour = active.reduce((sum, l) => {
    const perHour = (Number(l.pricePerInterval) / 1e18) * (l.intervalSecs ? 3600 / l.intervalSecs : 0);
    return sum + perHour;
  }, 0);

  const stats = [
    { k: "GPUs available", v: String(listings.filter((l) => l.available).length), c: `${providers.length} providers` },
    { k: "Active leases", v: String(active.length), c: address ? `${mine.length} yours` : "network wide" },
    { k: "Streaming now", v: `$${streamingPerHour.toFixed(2)}`, c: "per hour, from escrow" },
    { k: "Providers", v: String(providers.length), c: `${providers.filter((p) => p.attested).length} attested` },
  ];

  return (
    <div>
      <section className="mb-5 grid grid-cols-4 rounded-lg border border-line bg-surface">
        {stats.map((s, i) => (
          <div key={s.k} className={`px-[18px] py-4 ${i < 3 ? "border-r border-line" : ""}`}>
            <div className="text-xs font-medium text-muted">{s.k}</div>
            <div className="mono mt-2 text-2xl font-semibold tracking-tight">{s.v}</div>
            <div className="mt-1 text-xs text-faint">{s.c}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-[1.6fr_1fr] items-start gap-5">
        <Card>
          <CardHead title="Your active leases" action={<Link href="/leases" className="text-xs font-medium text-accent">Manage all</Link>} />
          {mine.length === 0 ? (
            <Empty title="No active leases" hint="Rent a GPU to get started" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="border-b border-line px-4 py-2.5 font-medium">GPU</th>
                    <th className="border-b border-line px-4 py-2.5 font-medium">Provider</th>
                    <th className="border-b border-line px-4 py-2.5 font-medium">Uptime</th>
                    <th className="border-b border-line px-4 py-2.5 font-medium">Streamed</th>
                    <th className="border-b border-line px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((l) => {
                    const gpu = listingById.get(l.listingId)?.gpu || "GPU";
                    const models = listingById.get(l.listingId)?.models ?? [];
                    const streamed = (BigInt(l.pricePerInterval) * BigInt(l.settledIntervals)).toString();
                    return (
                      <tr key={l.id} className="text-[13px] hover:bg-hover">
                        <td className="border-b border-line px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <GpuChip />
                            <div>
                              <b className="font-medium">{gpu}</b>
                              <small className="mono block text-[11px] text-faint">{models[0] ?? "container"}</small>
                            </div>
                          </div>
                        </td>
                        <td className="mono border-b border-line px-4 py-3 text-xs text-muted">{shortAddr(l.provider)}</td>
                        <td className="border-b border-line px-4 py-3">
                          <Heartbeats up={Math.min(l.heartbeatedIntervals, 8)} total={Math.min(Math.max(l.fundedIntervals, 1), 8)} />
                        </td>
                        <td className="mono border-b border-line px-4 py-3">{fmtUsd(streamed)}</td>
                        <td className="border-b border-line px-4 py-3"><StatusTag status={l.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHead title="Top providers" action={<Link href="/rent" className="text-xs font-medium text-accent">Browse</Link>} />
            {providers.length === 0 ? (
              <Empty title="No providers yet" />
            ) : (
              <div className="px-2 py-1">
                {providers.slice(0, 4).map((p, i) => (
                  <div key={p.address} className="flex items-center gap-3 px-2 py-2.5">
                    <span className="mono w-4 text-right text-xs text-faint">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="mono text-xs">{shortAddr(p.address)}</div>
                      <div className="text-[11px] text-faint">{p.gpu || "compute"}{p.attested ? " · attested" : ""}</div>
                    </div>
                    <span className="ml-auto"><RepBar score={repScore(p.reputation)} /></span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Run a model" />
            <div className="p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-line bg-panel text-accent">
                  <Icon name="model" className="h-[17px] w-[17px]" />
                </span>
                <div>
                  <b className="font-semibold">Managed inference</b>
                  <small className="block text-xs text-faint">OpenAI-compatible endpoint</small>
                </div>
              </div>
              <p className="mb-3 text-[13px] text-muted">Call open models served by providers, billed per token from prepaid credits.</p>
              <Link href="/models" className="block w-full rounded-md border border-line py-2.5 text-center text-[13px] font-medium text-ink2 hover:bg-hover hover:text-ink">
                Open playground
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
