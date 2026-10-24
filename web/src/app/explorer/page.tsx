"use client";

import { useState, type ReactNode } from "react";
import { useApi } from "@/lib/api";
import {
  Card,
  CardHead,
  PageHeader,
  CopyValue,
  Empty,
  ErrorNote,
  Skeleton,
  StatusTag,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import {
  ChallengeTrack,
  EscrowIntervals,
  Figure,
  HeartbeatStrip,
  LeaseLifecycle,
  TokenFlow,
} from "@/components/diagrams";
import { fmtInterval, fmtSmesh, shortAddr, shortHash } from "@/lib/format";
import type { ChainEvent, Challenge, JsonValue, Lease } from "@/lib/types";
import { KIND_STYLE, describe, isSlash, kindOf, timeAgo, type Kind } from "@/lib/events";

type Tab = "leases" | "challenges" | "activity";

const TABS: { id: Tab; label: string }[] = [
  { id: "leases", label: "Leases" },
  { id: "challenges", label: "Challenges" },
  { id: "activity", label: "Events and slashes" },
];

type Filter = "all" | "slashes" | "challenges";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All events" },
  { id: "challenges", label: "Challenges" },
  { id: "slashes", label: "Slashes" },
];

/* ------------------------------------------------------------------ helpers */

function big(value: string | number | null | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

function payloadText(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Intervals elapsed since a lease started, capped at what was funded. */
function elapsedIntervals(lease: Lease): number {
  if (lease.status !== "Active" || !lease.start || !lease.intervalSecs) return lease.heartbeatedIntervals;
  const secs = Math.floor(Date.now() / 1000) - lease.start;
  return Math.min(Math.max(Math.floor(secs / lease.intervalSecs), lease.heartbeatedIntervals), lease.fundedIntervals);
}

/**
 * Network-wide token movement derived from indexed state. Streamed is settled
 * intervals times price; refunded is the unsettled part of closed leases;
 * downtime slashes are the bonds of terminated leases; challenge slashes come
 * from failed benchmark challenges.
 */
function networkFlow(leases: Lease[], challenges: Challenge[]) {
  let escrowed = 0n;
  let paid = 0n;
  let refunded = 0n;
  let slashed = 0n;
  for (const lease of leases) {
    const price = big(lease.pricePerInterval);
    escrowed += price * BigInt(lease.fundedIntervals);
    paid += price * BigInt(lease.settledIntervals);
    if (["Ended", "Terminated", "Rejected", "Cancelled"].includes(lease.status)) {
      refunded += price * BigInt(Math.max(lease.fundedIntervals - lease.settledIntervals, 0));
    }
    if (lease.status === "Terminated") slashed += big(lease.bond);
  }
  const treasury = challenges.reduce((sum, c) => sum + big(c.slashed), 0n);
  return { escrowed, paid, refunded, slashed, treasury };
}

/* --------------------------------------------------------------------- page */

export default function ExplorerPage() {
  const [tab, setTab] = useState<Tab>("leases");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const leasesState = useApi<Lease[]>("/leases", 4000);
  const challengesState = useApi<Challenge[]>("/challenges", 5000);
  const eventsState = useApi<(ChainEvent & { timestamp?: number | null })[]>("/events/history?limit=250", 3000);

  const leases = [...(leasesState.data ?? [])].sort((a, b) => b.id - a.id);
  const challenges = [...(challengesState.data ?? [])].sort((a, b) => b.id - a.id);
  const events = [...(eventsState.data ?? [])].reverse();
  const visibleEvents =
    filter === "slashes"
      ? events.filter(isSlash)
      : filter === "challenges"
        ? events.filter((e) => kindOf(e) === "challenge" || /^Challenge/.test(e.name))
        : events;

  const selected =
    leases.find((l) => l.id === selectedId) ?? leases.find((l) => l.status === "Active") ?? leases[0] ?? null;
  const flow = networkFlow(leases, challenges);
  const anyActive = leases.some((l) => l.status === "Active");
  const error = leasesState.error ?? challengesState.error ?? eventsState.error;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Network"
        title="Explorer"
        description="Every lease, benchmark challenge, payment, and slash the indexer has read from the chain."
      />
      <Card>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 px-5 py-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-center">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Protocol state</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              Read-only data indexed from the chain. The figure totals every indexed lease and benchmark challenge.
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
              <Fact label="Leases" value={leases.length} />
              <Fact label="Challenges" value={challenges.length} />
              <Fact label="Streamed" value={fmtSmesh(flow.paid)} tone="success" />
              <Fact label="Slashed" value={fmtSmesh(flow.slashed + flow.treasury)} tone="danger" />
            </dl>
          </div>
          <Figure caption="SMESH moved by the protocol so far. The streaming edge is live while any lease is active.">
            <TokenFlow
              live={anyActive}
              amounts={{
                escrowed: fmtSmesh(flow.escrowed),
                paid: fmtSmesh(flow.paid),
                refunded: fmtSmesh(flow.refunded),
                slashed: fmtSmesh(flow.slashed),
                treasury: fmtSmesh(flow.treasury),
              }}
            />
          </Figure>
        </div>
        <div role="tablist" aria-label="Explorer sections" className="flex overflow-x-auto border-t border-line px-3">
          {TABS.map((item) => (
            <button
              key={item.id}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              onClick={() => setTab(item.id)}
              className={`shrink-0 border-b-2 px-3 py-3 text-[14px] font-medium transition-colors duration-fast ease-out ${
                tab === item.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Card>

      {error && <ErrorNote>Some explorer data could not be refreshed. {error}</ErrorNote>}

      {/* Leases */}
      <div id="panel-leases" role="tabpanel" aria-labelledby="tab-leases" hidden={tab !== "leases"} className="space-y-5">
        {selected && <LeaseDetail lease={selected} />}
        <Card>
          <CardHead title="Rental leases" sub={`${leases.length} indexed. Select a lease to inspect it.`} />
          {leasesState.loading ? (
            <Skeleton label="Loading leases" />
          ) : leasesState.error ? (
            <Empty icon="alert" title="Leases could not be loaded" hint="Check the orchestrator connection." />
          ) : leases.length === 0 ? (
            <Empty
              icon="inbox"
              title="No leases recorded"
              hint="Lease requests and their lifecycle state appear here as the indexer follows the chain."
            />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr>
                    <Th>Lease</Th>
                    <Th>Status</Th>
                    <Th>Requester</Th>
                    <Th>Provider</Th>
                    <Th>Intervals</Th>
                    <Th align="right">Escrow / bond</Th>
                    <Th align="right">
                      <span className="sr-only">Inspect</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {leases.map((lease) => {
                    const isSelected = selected?.id === lease.id;
                    return (
                      <Tr key={lease.id}>
                        <Td className={`mono ${isSelected ? "text-accent" : ""}`}>
                          #{lease.id}
                          <span className="block text-[12px] text-faint">listing #{lease.listingId}</span>
                        </Td>
                        <Td>
                          <StatusTag status={lease.status} />
                        </Td>
                        <Td>
                          <CopyValue value={lease.requester} label="requester address" />
                        </Td>
                        <Td>
                          <CopyValue value={lease.provider} label="provider address" />
                        </Td>
                        <Td className="mono text-[13px] text-ink2">
                          {lease.settledIntervals} settled of {lease.fundedIntervals}
                          <span className="block text-[12px] text-faint">{fmtInterval(lease.intervalSecs)} each</span>
                        </Td>
                        <Td align="right" className="mono">
                          {fmtSmesh(lease.escrow)}
                          <span className="block text-[12px] text-faint">{fmtSmesh(lease.bond)} bond</span>
                        </Td>
                        <Td align="right">
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            aria-label={`Inspect lease ${lease.id}`}
                            onClick={() => setSelectedId(lease.id)}
                            className={`h-8 rounded-md border px-2.5 text-[13px] font-medium transition-colors duration-fast ease-out ${
                              isSelected
                                ? "border-accent bg-accent-weak text-accent"
                                : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink"
                            }`}
                          >
                            {isSelected ? "Inspecting" : "Inspect"}
                          </button>
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

      {/* Challenges */}
      <div id="panel-challenges" role="tabpanel" aria-labelledby="tab-challenges" hidden={tab !== "challenges"}>
        <Card>
          <CardHead
            title="Benchmark challenges"
            sub="Seeded challenges issued by the attester. A missed deadline is slashed by anyone; a wrong answer is slashed by the attester."
          />
          {challengesState.loading ? (
            <Skeleton label="Loading challenges" />
          ) : challenges.length === 0 ? (
            <Empty icon="shield" title="No challenges issued" hint="The attester service challenges each attested provider on a fixed interval." />
          ) : (
            <>
              <div className="border-b border-line px-5 py-5">
                <ChallengeTrack challenges={challenges} limit={60} />
              </div>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse">
                  <thead>
                    <tr>
                      <Th>Challenge</Th>
                      <Th>Provider</Th>
                      <Th>Outcome</Th>
                      <Th align="right">Score</Th>
                      <Th align="right">Slashed</Th>
                      <Th>Answered in</Th>
                      <Th>Issued</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {challenges.slice(0, 50).map((c) => (
                      <Tr key={c.id}>
                        <Td className="mono">#{c.id}</Td>
                        <Td>
                          <CopyValue value={c.provider} label="provider address" />
                        </Td>
                        <Td>
                          <ChallengeOutcome status={c.status} />
                        </Td>
                        <Td align="right" className="mono">
                          {c.score ?? <span className="text-faint">None</span>}
                        </Td>
                        <Td align="right" className={`mono ${big(c.slashed) > 0n ? "text-danger" : "text-faint"}`}>
                          {big(c.slashed) > 0n ? fmtSmesh(c.slashed) : "0"}
                        </Td>
                        <Td className="mono text-[13px] text-ink2">
                          {c.responded?.timestamp && c.issuedAt ? `${c.responded.timestamp - c.issuedAt}s` : <span className="text-faint">None</span>}
                        </Td>
                        <Td className="text-[13px] text-muted">
                          {timeAgo(c.issuedAt)}
                          {c.issued && <span className="mono block text-[12px] text-faint">block {c.issued.blockNumber}</span>}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Event timeline */}
      <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden={tab !== "activity"}>
        <Card>
          <CardHead
            title="Chronological activity"
            sub="Newest block and log index first"
            action={
              <div className="flex rounded-md border border-line bg-bg p-0.5" aria-label="Activity filter">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={filter === f.id}
                    onClick={() => setFilter(f.id)}
                    className={`rounded-[4px] px-3 py-1.5 text-[13px] font-medium transition-colors duration-fast ease-out ${
                      filter === f.id ? "bg-hover text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            }
          />
          {eventsState.loading ? (
            <Skeleton label="Loading event history" />
          ) : eventsState.error ? (
            <Empty icon="alert" title="Event history could not be loaded" hint="Check the orchestrator connection." />
          ) : visibleEvents.length === 0 ? (
            <Empty
              icon="pulse"
              title={filter === "slashes" ? "No slashing events recorded" : "No events indexed"}
              hint="On-chain events appear here once the indexer catches up with the latest block."
            />
          ) : (
            <>
              <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-line px-5 py-3 text-[12px] text-muted">
                {(Object.keys(KIND_STYLE) as Kind[]).map((k) => (
                  <li key={k} className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${KIND_STYLE[k].dot}`} aria-hidden />
                    {KIND_STYLE[k].label}
                  </li>
                ))}
              </ul>
              <ol className="px-5 py-2">
                {visibleEvents.map((event) => (
                  <TimelineItem key={`${event.blockNumber}-${event.logIndex}-${event.transactionHash}`} event={event} />
                ))}
              </ol>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- components */

function Fact({ label, value, tone }: { label: string; value: ReactNode; tone?: "success" | "danger" }) {
  return (
    <div>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd
        className={`mono mt-1 text-[18px] font-semibold leading-none ${
          tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function ChallengeOutcome({ status }: { status: Challenge["status"] }) {
  const tone =
    status === "passed" ? "text-success" : status === "failed" ? "text-danger" : status === "lapsed" ? "text-faint" : "text-accent";
  const dot =
    status === "passed" ? "bg-success" : status === "failed" ? "bg-danger" : status === "lapsed" ? "bg-faint" : "bg-accent";
  const label = status === "failed" ? "failed, slashed" : status === "responded" ? "answered, judging" : status;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${status === "open" ? "live-dot" : ""}`} aria-hidden />
      {label}
    </span>
  );
}

function LeaseDetail({ lease }: { lease: Lease }) {
  const elapsed = elapsedIntervals(lease);
  return (
    <Card>
      <CardHead
        title={`Lease ${lease.id}`}
        sub={`${shortAddr(lease.requester)} rents from ${shortAddr(lease.provider)} at ${fmtSmesh(lease.pricePerInterval)} per ${fmtInterval(lease.intervalSecs)}`}
        action={<StatusTag status={lease.status} />}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 px-5 py-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Figure caption="Where this lease sits in the RentalMarket state machine.">
          <LeaseLifecycle status={lease.status} />
        </Figure>
        <div className="space-y-6">
          <div>
            <h4 className="mb-3 text-[13px] font-medium text-muted">Heartbeats</h4>
            <HeartbeatStrip elapsed={elapsed} beats={lease.heartbeatedIntervals} live={lease.status === "Active"} />
          </div>
          <div>
            <h4 className="mb-3 text-[13px] font-medium text-muted">Escrow by interval</h4>
            <EscrowIntervals
              funded={lease.fundedIntervals}
              heartbeated={lease.heartbeatedIntervals}
              settled={lease.settledIntervals}
              max={lease.maxIntervals}
              current={lease.status === "Active" && elapsed < lease.fundedIntervals ? elapsed : null}
            />
          </div>
          <div className="text-[13px] text-muted">
            Manifest{" "}
            <span className="mono text-ink2" title={lease.manifest}>
              {shortHash(lease.manifest)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function TimelineItem({ event }: { event: ChainEvent & { timestamp?: number | null } }) {
  const kind = kindOf(event);
  const text = describe(event);
  return (
    <li className="relative grid grid-cols-[1.25rem_1fr] gap-x-3 py-3">
      {/* The rail: one hairline that joins the event dots. */}
      <span className="absolute bottom-0 left-[0.3rem] top-0 w-px bg-line" aria-hidden />
      <span className={`relative mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${KIND_STYLE[kind].dot}`} aria-hidden />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`text-[14px] font-medium ${kind === "slash" ? "text-danger" : "text-ink"}`}>
            {text ?? event.name}
          </span>
          <span className="mono text-[12px] text-faint">
            {event.name} · block {event.blockNumber}:{event.logIndex}
            {event.timestamp ? ` · ${timeAgo(event.timestamp)}` : ""}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {!text &&
            Object.entries(event.payload).map(([key, value]) => {
              const v = payloadText(value);
              return (
                <span key={key} className="inline-flex min-w-0 items-center gap-1.5">
                  <span className="text-[12px] text-faint">{key}</span>
                  <span className="mono max-w-[220px] truncate text-[13px] text-ink2" title={v}>
                    {shortHash(v)}
                  </span>
                </span>
              );
            })}
          <CopyValue value={event.transactionHash} label="transaction hash" />
        </div>
      </div>
    </li>
  );
}
