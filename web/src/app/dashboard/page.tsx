"use client";

import Link from "next/link";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import {
  Button,
  Card,
  CardHead,
  Empty,
  GpuChip,
  Heartbeats,
  RepBar,
  Skeleton,
  Stat,
  StatusTag,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtInterval, fmtUsd, repScore, shortAddr, usd } from "@/lib/format";
import type { Lease, Listing, Provider } from "@/lib/types";

function perHour(pricePerInterval: string, intervalSecs: number): number {
  if (!intervalSecs) return 0;
  return usd(pricePerInterval) * (3600 / intervalSecs);
}

export default function OverviewPage() {
  const { address, connect, connecting } = useWallet();
  const listingsState = useApi<Listing[]>("/listings?all=true", 5000);
  const leasesState = useApi<Lease[]>("/leases", 4000);
  const providersState = useApi<Provider[]>("/providers", 8000);

  const listings = listingsState.data ?? [];
  const leases = leasesState.data ?? [];
  const providers = providersState.data ?? [];

  const listingById = new Map(listings.map((l) => [l.id, l]));
  const active = leases.filter((l) => l.status === "Active");
  const available = listings.filter((l) => l.available);

  // Only ever attribute leases to a connected account. Without a wallet there is
  // no "yours", so the panel prompts to connect instead of showing the network.
  const mine = address
    ? active.filter((l) => l.requester.toLowerCase() === address.toLowerCase())
    : [];

  const streamingPerHour = active.reduce(
    (sum, l) => sum + perHour(l.pricePerInterval, l.intervalSecs),
    0,
  );
  const attested = providers.filter((p) => p.attested).length;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 divide-line rounded-lg border border-line bg-surface sm:grid-cols-4 sm:divide-x">
        <div className="border-b border-line sm:border-b-0">
          <Stat
            label="GPUs available"
            value={available.length}
            sub={`${listings.length} listed in total`}
          />
        </div>
        <div className="border-b border-l border-line sm:border-b-0 sm:border-l-0">
          <Stat
            label="Active leases"
            value={active.length}
            sub={address ? `${mine.length} yours` : "connect to see yours"}
          />
        </div>
        <div className="border-line">
          <Stat
            label="Streaming now"
            value={`$${streamingPerHour.toFixed(2)}`}
            sub="per hour, from escrow"
            tone="accent"
          />
        </div>
        <div className="border-l border-line sm:border-l-0">
          <Stat label="Providers" value={providers.length} sub={`${attested} attested`} />
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHead
              title="Your active leases"
              sub="Compute you are currently paying for"
              action={
                <Link
                  href="/leases"
                  className="rounded-md px-1 text-[13px] font-medium text-accent hover:text-accent-hover"
                >
                  Manage all
                </Link>
              }
            />
            {!address ? (
              <Empty
                icon="wallet"
                title="Connect a wallet to see your leases"
                hint="Leases are held by the account that funded the escrow, so the dashboard needs to know which account is yours."
                action={
                  <Button variant="primary" icon="wallet" onClick={connect} loading={connecting}>
                    Connect wallet
                  </Button>
                }
              />
            ) : leasesState.loading ? (
              <Skeleton label="Loading your leases" rows={2} />
            ) : mine.length === 0 ? (
              <Empty
                icon="gpu"
                title="No active leases"
                hint="Rent a GPU from a staked provider. Escrow is deposited up front and streams to the provider only for intervals they prove they served."
                action={
                  <Link href="/rent">
                    <Button variant="primary" icon="gpu">
                      Browse GPUs
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead>
                    <tr>
                      <Th>GPU</Th>
                      <Th>Provider</Th>
                      <Th>Uptime</Th>
                      <Th align="right">Streamed</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((l) => {
                      const listing = listingById.get(l.listingId);
                      const streamed = (
                        BigInt(l.pricePerInterval) * BigInt(l.settledIntervals)
                      ).toString();
                      return (
                        <Tr key={l.id}>
                          <Td>
                            <div className="flex items-center gap-3">
                              <GpuChip live />
                              <div className="min-w-0">
                                <div className="font-medium text-ink">{listing?.gpu || "GPU"}</div>
                                <div className="mono truncate text-[12px] text-faint">
                                  {listing?.models[0] ?? "container workload"}
                                </div>
                              </div>
                            </div>
                          </Td>
                          <Td className="mono text-muted">{shortAddr(l.provider)}</Td>
                          <Td>
                            <Heartbeats
                              up={l.heartbeatedIntervals}
                              total={Math.min(Math.max(l.fundedIntervals, 1), 10)}
                              live={l.status === "Active"}
                            />
                          </Td>
                          <Td align="right" className="mono font-medium">
                            {fmtUsd(streamed)}
                          </Td>
                          <Td>
                            <StatusTag status={l.status} />
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
              title="Available capacity"
              sub="Staked providers ready to accept a lease"
              action={
                <Link
                  href="/rent"
                  className="rounded-md px-1 text-[13px] font-medium text-accent hover:text-accent-hover"
                >
                  Rent a GPU
                </Link>
              }
            />
            {listingsState.loading ? (
              <Skeleton label="Loading capacity" rows={3} />
            ) : available.length === 0 ? (
              <Empty
                icon="gpu"
                title="No capacity listed"
                hint="Providers publish capacity from the provider console once they have staked and passed attestation."
              />
            ) : (
              <ul className="rule">
                {available.slice(0, 4).map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-5 py-3.5">
                    <GpuChip />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{l.gpu || "Compute"}</div>
                      <div className="truncate text-[13px] text-muted">
                        {l.vramGB ? `${l.vramGB} GB` : "CPU"}
                        {l.region ? ` · ${l.region}` : ""}
                        {l.models.length ? ` · ${l.models.length} model${l.models.length > 1 ? "s" : ""}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="mono font-medium text-ink">
                        ${perHour(l.pricePerInterval, l.intervalSecs).toFixed(2)}
                        <span className="text-[13px] font-normal text-faint">/hr</span>
                      </div>
                      <div className="text-[12px] text-faint">
                        {fmtInterval(l.intervalSecs)} intervals
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHead
              title="Top providers"
              sub="Ranked by reputation"
              action={
                <Link
                  href="/providers"
                  className="rounded-md px-1 text-[13px] font-medium text-accent hover:text-accent-hover"
                >
                  Console
                </Link>
              }
            />
            {providersState.loading ? (
              <Skeleton label="Loading providers" rows={3} />
            ) : providers.length === 0 ? (
              <Empty
                icon="providers"
                title="No providers registered"
                hint="Providers appear here after they register and stake collateral."
              />
            ) : (
              <ul className="rule">
                {[...providers]
                  .sort((a, b) => b.reputation - a.reputation)
                  .slice(0, 4)
                  .map((p, i) => (
                    <li key={p.address} className="flex items-center gap-3 px-5 py-3">
                      <span className="mono w-4 shrink-0 text-right text-[13px] text-faint">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mono truncate text-[13px] text-ink2">
                          {shortAddr(p.address)}
                        </div>
                        <div className="truncate text-[12px] text-faint">
                          {p.gpu || "compute"}
                          {p.attested ? " · attested" : ""}
                        </div>
                      </div>
                      <RepBar score={repScore(p.reputation)} />
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHead title="Run a model" sub="Managed inference" />
            <div className="p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-accent bg-accent-weak text-accent">
                  <Icon name="model" className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <p className="text-[13px] leading-relaxed text-muted">
                  Call open models on an OpenAI-compatible endpoint. Requests are signed by your
                  wallet, routed to the provider holding your prepaid credit, and metered per token
                  on chain.
                </p>
              </div>
              <Link href="/models" className="mt-4 block">
                <Button variant="secondary" icon="send" className="w-full">
                  Open playground
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
