"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useApi } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { Button, Facts, PageHeader, Section, StatusTag } from "@/components/ui";
import { HeartbeatStrip } from "@/components/diagrams";
import { Icon, type IconName } from "@/components/icons";
import { KIND_STYLE, describe, kindOf, timeAgo } from "@/lib/events";
import { fmtInterval, fmtSmesh, repScore, shortAddr, usd } from "@/lib/format";
import type { ChainEvent, Challenge, Lease, Listing, Provider } from "@/lib/types";

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function sumWei(values: string[]): bigint {
  return values.reduce((total, v) => {
    try {
      return total + BigInt(v);
    } catch {
      return total;
    }
  }, 0n);
}

/** SMESH streamed per hour by a lease, from its interval price. */
function perHour(lease: { pricePerInterval: string; intervalSecs: number }): number {
  return lease.intervalSecs ? usd(lease.pricePerInterval) * (3600 / lease.intervalSecs) : 0;
}

/** The same rate in token base units, exact. */
function perHourWei(lease: { pricePerInterval: string; intervalSecs: number }): bigint {
  if (!lease.intervalSecs) return 0n;
  try {
    return (BigInt(lease.pricePerInterval) * 3600n) / BigInt(lease.intervalSecs);
  } catch {
    return 0n;
  }
}

function elapsedIntervals(lease: Lease): number {
  if (!lease.start || !lease.intervalSecs) return lease.heartbeatedIntervals;
  const secs = Math.floor(Date.now() / 1000) - lease.start;
  return Math.min(Math.max(Math.floor(secs / lease.intervalSecs), lease.heartbeatedIntervals), lease.fundedIntervals);
}

export default function HomePage() {
  const { address, connect, connecting } = useWallet();
  const listings = useApi<Listing[]>("/listings?all=true", 6000).data ?? [];
  const leases = useApi<Lease[]>("/leases", 4000).data ?? [];
  const providers = useApi<Provider[]>("/providers", 8000).data ?? [];
  const challenges = useApi<Challenge[]>("/challenges", 8000).data ?? [];
  const events = useApi<(ChainEvent & { timestamp?: number | null })[]>("/events/history?limit=60", 4000).data ?? [];

  const active = leases.filter((l) => l.status === "Active");
  const available = listings.filter((l) => l.available);
  const mine = active.filter((l) => same(l.requester, address));
  const me = providers.find((p) => same(p.address, address) && p.registered) ?? null;
  const serving = active.filter((l) => same(l.provider, address));
  const myChallenges = challenges.filter((c) => same(c.provider, address)).sort((a, b) => b.id - a.id);

  const recent = [...events].reverse().filter((e) => describe(e) !== null).slice(0, 8);

  return (
    <div className="space-y-12">
      <PageHeader
        title="Home"
        description={
          address
            ? "What you are renting, what you are serving, and what the network is doing right now."
            : "Connect a wallet to see your leases and your node. The network view below is public."
        }
        actions={
          !address && (
            <Button variant="primary" icon="wallet" onClick={connect} loading={connecting}>
              {connecting ? "Connecting" : "Connect wallet"}
            </Button>
          )
        }
      />

      {/* The two roles a wallet can play, side by side. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RolePanel
          icon="gpu"
          role="Renting"
          title={mine.length ? `${mine.length} active ${mine.length === 1 ? "lease" : "leases"}` : "No active leases"}
          summary={
            mine.length
              ? `${fmtSmesh(mine.reduce((s, l) => s + perHourWei(l), 0n))} per hour streaming from your escrow.`
              : address
                ? "Lease a GPU from a staked provider. Escrow pays out one interval at a time."
                : "Connect a wallet to see the leases it funds."
          }
          action={
            <Link href={mine.length ? "/leases" : "/rent"} className="text-[13px] font-medium text-accent hover:underline hover:underline-offset-4">
              {mine.length ? "Open My leases" : "Browse the marketplace"}
            </Link>
          }
        >
          {mine.slice(0, 2).map((lease) => (
            <div key={lease.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4">
              <div className="min-w-[8rem]">
                <div className="mono text-[13px] text-ink">Lease {lease.id}</div>
                <div className="mt-0.5 text-[12px] text-faint">from {shortAddr(lease.provider)}</div>
              </div>
              <div className="flex-1">
                <HeartbeatStrip elapsed={elapsedIntervals(lease)} beats={lease.heartbeatedIntervals} live />
              </div>
            </div>
          ))}
        </RolePanel>

        <RolePanel
          icon="pulse"
          role="Providing"
          title={me ? (me.attested ? "Node attested and serving" : "Node registered, awaiting attestation") : "Not a provider yet"}
          summary={
            me
              ? `${fmtSmesh(me.stake)} staked, reputation ${repScore(me.reputation)} of 100, ${serving.length} ${serving.length === 1 ? "lease" : "leases"} in service.`
              : "Stake SMESH and rent out a GPU. The operator attests the hardware, then benchmark challenges keep checking it."
          }
          action={
            <Link href="/provide" className="text-[13px] font-medium text-accent hover:underline hover:underline-offset-4">
              {me ? "Open Node" : "Set up a node"}
            </Link>
          }
        >
          {me && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4 text-[13px]">
              <StatusTag status={me.active ? "Active" : "Inactive"} />
              <span className="text-muted">
                Challenges <span className="mono text-ink">{me.challengesPassed ?? 0}</span> passed,{" "}
                <span className={`mono ${(me.challengesFailed ?? 0) > 0 ? "text-danger" : "text-ink"}`}>{me.challengesFailed ?? 0}</span> failed
              </span>
              {myChallenges[0] && <span className="text-faint">last {timeAgo(myChallenges[0].issuedAt)}</span>}
            </div>
          )}
        </RolePanel>
      </div>

      <Section title="Network now" description="Live figures from the indexer.">
        <Facts
          items={[
            { label: "GPUs available", value: available.length, sub: `${listings.length} listed` },
            { label: "Active leases", value: active.length, sub: `${fmtSmesh(sumWei(active.map((l) => l.escrow)))} in escrow` },
            { label: "Attested providers", value: providers.filter((p) => p.attested).length, sub: `${providers.length} registered` },
            {
              label: "Challenges passed",
              value: challenges.filter((c) => c.status === "passed").length,
              sub: `${challenges.filter((c) => c.status === "failed").length} failed and slashed`,
              tone: "success",
            },
          ]}
        />
      </Section>

      <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
        <Section
          title="Recent activity"
          description="Leases, payments, challenges, and slashes as they reach the chain."
          action={
            <Link href="/explorer" className="text-[13px] font-medium text-accent hover:underline hover:underline-offset-4">
              Explorer
            </Link>
          }
        >
          {recent.length === 0 ? (
            <p className="py-6 text-[14px] text-muted">No activity indexed yet.</p>
          ) : (
            <ol className="space-y-3.5">
              {recent.map((e) => (
                <li key={`${e.blockNumber}-${e.logIndex}`} className="flex items-baseline gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 self-start rounded-full ${KIND_STYLE[kindOf(e)].dot}`} aria-hidden />
                  <span className={`min-w-0 flex-1 text-[14px] ${kindOf(e) === "slash" ? "text-danger" : "text-ink2"}`}>{describe(e)}</span>
                  <span className="mono shrink-0 text-[12px] text-faint">{e.timestamp ? timeAgo(e.timestamp) : `block ${e.blockNumber}`}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section
          title="Available capacity"
          action={
            <Link href="/rent" className="text-[13px] font-medium text-accent hover:underline hover:underline-offset-4">
              Marketplace
            </Link>
          }
        >
          {available.length === 0 ? (
            <p className="py-6 text-[14px] text-muted">Every listing is reserved right now.</p>
          ) : (
            <ul className="divide-y divide-line">
              {available.slice(0, 4).map((l) => (
                <li key={l.id}>
                  <Link href="/rent" className="group flex items-center gap-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-ink group-hover:underline group-hover:underline-offset-4">
                        {l.gpu || `Listing ${l.id}`}
                      </div>
                      <div className="mt-0.5 text-[12px] text-faint">
                        {l.vramGB ? `${l.vramGB} GB` : "VRAM not stated"} · {l.region || "region not stated"} · {fmtInterval(l.intervalSecs)} intervals
                      </div>
                    </div>
                    <div className="mono text-right text-[14px] text-ink">
                      {perHour(l).toFixed(2)}
                      <span className="block text-[12px] text-faint">SMESH / h</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function RolePanel({
  icon,
  role,
  title,
  summary,
  action,
  children,
}: {
  icon: IconName;
  role: string;
  title: string;
  summary: string;
  action: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6" aria-label={role}>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-muted">
          <Icon name={icon} className="h-4 w-4 text-faint" aria-hidden />
          {role}
        </span>
        {action}
      </div>
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{summary}</p>
      </div>
      {children}
    </section>
  );
}
