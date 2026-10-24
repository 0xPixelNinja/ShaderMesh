"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useApi } from "@/lib/api";
import { CHAIN_ID } from "@/lib/config";
import { fmtInterval, fmtSmesh, shortAddr, usd } from "@/lib/format";
import type { Challenge, Lease, Listing, Provider } from "@/lib/types";
import { Logo, Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChallengeTrack, EscrowIntervals, Figure, HeartbeatStrip, LeaseLifecycle, TokenFlow } from "@/components/diagrams";

const NETWORK = CHAIN_ID === 11155111 ? "Sepolia testnet" : "Local devnet";

/** Staggered one-shot reveal, landing page only. */
const rise = (i: number) => ({ "--i": i }) as CSSProperties;

function sumWei(values: string[]): bigint {
  return values.reduce((total, v) => {
    try {
      return total + BigInt(v);
    } catch {
      return total;
    }
  }, 0n);
}

/** Elapsed intervals of a lease, capped at what was funded. */
function elapsedIntervals(lease: Lease): number {
  if (!lease.start || !lease.intervalSecs) return 0;
  const secs = Math.floor(Date.now() / 1000) - lease.start;
  return Math.min(Math.max(Math.floor(secs / lease.intervalSecs), 0), lease.fundedIntervals);
}

export default function LandingPage() {
  const leases = useApi<Lease[]>("/leases", 5000).data ?? [];
  const listings = useApi<Listing[]>("/listings?all=true", 8000).data ?? [];
  const providers = useApi<Provider[]>("/providers", 8000).data ?? [];
  const challenges = useApi<Challenge[]>("/challenges", 8000).data ?? [];

  const active = leases.filter((l) => l.status === "Active");
  const featured = active[0] ?? null;
  const escrowed = sumWei(active.map((l) => l.escrow));
  const attested = providers.filter((p) => p.attested).length;
  const passed = challenges.filter((c) => c.status === "passed").length;

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-sticky border-b border-line bg-bg">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="ShaderMesh home">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">ShaderMesh</span>
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-6 text-[14px] text-muted md:flex">
            <a href="#how" className="transition-colors duration-fast ease-out hover:text-ink hover:underline hover:underline-offset-4">
              How it works
            </a>
            <a href="#trust" className="transition-colors duration-fast ease-out hover:text-ink hover:underline hover:underline-offset-4">
              Trust model
            </a>
            <Link href="/explorer" className="transition-colors duration-fast ease-out hover:text-ink hover:underline hover:underline-offset-4">
              Explorer
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-accent bg-accent px-3.5 text-[13px] font-medium text-accent-ink transition-colors duration-fast ease-out hover:border-accent-hover hover:bg-accent-hover active:bg-accent"
            >
              Open app
              <Icon name="arrow" className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1200px] gap-12 px-5 pb-16 pt-16 sm:px-8 md:pt-24 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <p style={rise(0)} className="reveal inline-flex items-center gap-2 text-[13px] font-medium text-muted">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              Compute rental on Ethereum, live on {NETWORK}
            </p>
            <h1 style={rise(1)} className="reveal mt-5 text-[36px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[56px]">
              Rent GPUs by the hour.
              <br />
              <span className="text-muted">Settle on Ethereum.</span>
            </h1>
            <p style={rise(2)} className="reveal mt-6 max-w-[34rem] text-[18px] leading-[1.6] text-ink2">
              Providers stake SMESH and serve containers and LLM inference from their own hardware. Requesters pay
              into escrow that streams to the provider one interval at a time. Missed heartbeats and failed benchmark
              challenges are slashed on chain.
            </p>
            <div style={rise(3)} className="reveal mt-8 flex flex-wrap gap-3">
              <Link
                href="/rent"
                className="inline-flex h-11 items-center gap-2 rounded-md border border-accent bg-accent px-5 text-[14px] font-medium text-accent-ink transition-colors duration-fast ease-out hover:border-accent-hover hover:bg-accent-hover"
              >
                Rent a GPU
                <Icon name="arrow" className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/models"
                className="inline-flex h-11 items-center rounded-md border border-line-strong bg-surface px-5 text-[14px] font-medium text-ink transition-colors duration-fast ease-out hover:border-ink2 hover:bg-hover"
              >
                Call a model
              </Link>
            </div>
          </div>

          <div style={rise(4)} className="reveal">
            <LeaseCard lease={featured} />
          </div>
        </section>

        {/* Live network figures */}
        <section aria-label="Network figures" className="border-y border-line bg-chrome">
          <dl className="mx-auto grid max-w-[1200px] grid-cols-2 px-5 sm:px-8 md:grid-cols-5">
            <Figure5 label="Attested providers" value={attested} />
            <Figure5 label="GPUs listed" value={listings.length} />
            <Figure5 label="Active leases" value={active.length} />
            <Figure5 label="Held in escrow" value={fmtSmesh(escrowed, 0)} />
            <Figure5 label="Challenges passed" value={passed} />
          </dl>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-16 sm:px-8 md:py-24">
          <SectionHead
            kicker="How it works"
            title="A market where the chain holds the money and the evidence."
            body="Compute runs off chain in Docker containers on provider machines. The contracts only decide who staked, who owes whom, and who is slashed."
          />
          <ol className="mt-12 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
            <Step n="01" title="Stake and attest">
              A provider registers, stakes at least 50 SMESH, and is attested for its GPU. The attester then issues
              seeded benchmark challenges that the provider must answer before a deadline.
            </Step>
            <Step n="02" title="Lease or call">
              A requester leases a listing with escrow bound to a container manifest, or buys prepaid credit and calls
              the OpenAI-compatible endpoint with a signed request.
            </Step>
            <Step n="03" title="Stream and settle">
              Each interval with a signed heartbeat releases its share of escrow to the provider. Downtime terminates
              the lease, refunds the remainder, and slashes the provider bond.
            </Step>
          </ol>

          <div className="mt-16 grid gap-12 lg:grid-cols-2">
            <Figure n={1} caption="Lease lifecycle in RentalMarket. The active state is lit.">
              <LeaseLifecycle status="Active" />
            </Figure>
            <Figure n={2} caption="Where SMESH moves. The streaming edge is live while a lease is active.">
              <TokenFlow
                live
                amounts={{ escrowed: "deposit", paid: "per interval", refunded: "unused", slashed: "bond", treasury: "free stake" }}
              />
            </Figure>
          </div>
        </section>

        {/* Trust model */}
        <section id="trust" className="border-t border-line bg-chrome">
          <div className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-16 sm:px-8 md:py-24">
            <SectionHead
              kicker="Trust model"
              title="Clear about what is enforced, and what is not."
              body="A rented result cannot be re-executed and checked, so rental trust rests on availability evidence and collateral at risk."
            />
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              <TrustList
                title="Enforced on chain"
                tone="success"
                items={[
                  "Escrow custody, per-interval payout, and refunds in RentalMarket",
                  "Bonds locked against each active lease, slashed for downtime",
                  "Missed benchmark deadlines slash free stake with no trusted input",
                  "Signed, prepaid inference credit with cumulative settlement",
                  "Off-chain services never hold funds or decide outcomes",
                ]}
              />
              <TrustList
                title="Not claimed"
                tone="muted"
                items={[
                  "LLM output is not verified on chain",
                  "The attester is a trusted role that judges benchmark answers",
                  "A benchmark proves responsiveness and throughput, not exact hardware",
                  "Heartbeats prove liveness of the provider key, not workload quality",
                ]}
              />
            </div>

            <div className="mt-12 rounded-lg border border-line bg-surface p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-[15px] font-semibold">Benchmark challenges on the network</h3>
                <Link href="/explorer" className="text-[13px] font-medium text-accent hover:underline hover:underline-offset-4">
                  View in explorer
                </Link>
              </div>
              <div className="mt-5">
                <ChallengeTrack challenges={challenges} limit={40} />
              </div>
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8 md:py-24">
          <div className="flex flex-col items-start justify-between gap-6 border-t border-line pt-12 md:flex-row md:items-end">
            <div>
              <h2 className="text-[24px] font-semibold leading-[1.3] tracking-[-0.02em] sm:text-[36px]">
                Bring a GPU, or rent one.
              </h2>
              <p className="mt-3 max-w-[32rem] text-[16px] leading-[1.6] text-ink2">
                Connect a wallet on {NETWORK} to lease capacity, call a model, or list your own hardware from the
                provider console.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/providers"
                className="inline-flex h-11 items-center rounded-md border border-line-strong bg-surface px-5 text-[14px] font-medium transition-colors duration-fast ease-out hover:border-ink2 hover:bg-hover"
              >
                Provide compute
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center gap-2 rounded-md border border-accent bg-accent px-5 text-[14px] font-medium text-accent-ink transition-colors duration-fast ease-out hover:border-accent-hover hover:bg-accent-hover"
              >
                Open app
                <Icon name="arrow" className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-[13px] text-faint sm:px-8">
          <span>ShaderMesh. Final-year project prototype on {NETWORK}.</span>
          <span className="mono">SmeshToken · ProviderRegistry · RentalMarket · InferenceMarket · JobMarket · Verification</span>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="max-w-[44rem]">
      <p className="text-[13px] font-medium text-accent">{kicker}</p>
      <h2 className="mt-3 text-[24px] font-semibold leading-[1.3] tracking-[-0.02em] sm:text-[36px]">{title}</h2>
      <p className="mt-4 text-[16px] leading-[1.6] text-ink2">{body}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="bg-surface p-6">
      <span className="mono text-[13px] text-faint">{n}</span>
      <h3 className="mt-3 text-[18px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-2 text-[14px] leading-[1.6] text-ink2">{children}</p>
    </li>
  );
}

function Figure5({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-line py-6 pr-4 md:border-l md:pl-6 md:first:border-l-0 md:first:pl-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mono mt-2 text-[24px] font-semibold leading-none tracking-tight">{value}</dd>
    </div>
  );
}

function TrustList({ title, items, tone }: { title: string; items: string[]; tone: "success" | "muted" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-[14px] leading-[1.5] text-ink2">
            <Icon
              name={tone === "success" ? "check" : "close"}
              className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "success" ? "text-success" : "text-faint"}`}
              aria-hidden
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The hero figure: the first live lease, or a labelled example when none is active. */
function LeaseCard({ lease }: { lease: Lease | null }) {
  const example = !lease;
  const funded = lease?.fundedIntervals ?? 10;
  const settled = lease?.settledIntervals ?? 7;
  const beats = lease?.heartbeatedIntervals ?? 8;
  const elapsed = lease ? Math.max(elapsedIntervals(lease), beats) : 9;
  const max = lease?.maxIntervals ?? 16;
  const perHour = lease ? usd(lease.pricePerInterval) * (3600 / (lease.intervalSecs || 3600)) : 1;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="text-[13px] text-muted">{example ? "Example lease" : `Lease ${lease.id}`}</div>
          <div className="mono mt-1 text-[15px] font-semibold">
            {example ? "RTX 4070 Laptop, 8 GB" : `provider ${shortAddr(lease.provider)}`}
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent-weak px-2.5 py-1 text-[12px] font-medium text-accent">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          {example ? "Illustration" : "Active"}
        </span>
      </div>
      <div className="space-y-6 px-5 py-5">
        <div>
          <div className="mb-3 flex items-baseline justify-between text-[13px]">
            <span className="text-muted">Heartbeats</span>
            <span className="mono text-faint">{lease ? fmtInterval(lease.intervalSecs) : "1h"} interval</span>
          </div>
          <HeartbeatStrip elapsed={elapsed} beats={beats} live={!example} />
        </div>
        <div>
          <div className="mb-3 flex items-baseline justify-between text-[13px]">
            <span className="text-muted">Escrow by interval</span>
            <span className="mono text-faint">{perHour.toFixed(2)} SMESH / h</span>
          </div>
          <EscrowIntervals funded={funded} heartbeated={beats} settled={settled} max={max} current={elapsed < funded ? elapsed : null} />
        </div>
      </div>
    </div>
  );
}
