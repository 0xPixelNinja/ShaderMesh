"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { Card, CardHead, CopyValue, Empty, StatusTag } from "@/components/ui";
import { fmtSmesh, shortHash } from "@/lib/format";
import type { ChainEvent, JsonValue, Lease } from "@/lib/types";

type Tab = "leases" | "activity";

const tabs: { id: Tab; label: string }[] = [
  { id: "leases", label: "Leases" },
  { id: "activity", label: "Events and slashes" },
];

function Skeleton({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="space-y-3 p-4">{[0, 1, 2, 3].map((row) => <div key={row} className="h-10 animate-pulse rounded-md bg-panel" />)}</div>;
}

function ProtocolValue({ value, label }: { value: string | null; label: string }) {
  if (!value) return <span className="text-faint">None</span>;
  if (value.startsWith("0x")) return <CopyValue value={value} label={label} />;
  return <span className="mono block max-w-[240px] truncate text-xs text-muted" title={value}>{shortHash(value)}</span>;
}

function payloadText(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ExplorerPage() {
  const [tab, setTab] = useState<Tab>("leases");
  const [activityFilter, setActivityFilter] = useState<"all" | "slashes">("all");
  const leasesState = useApi<Lease[]>("/leases", 4000);
  const eventsState = useApi<ChainEvent[]>("/events/history?limit=250", 3000);
  const leases = [...(leasesState.data ?? [])].sort((a, b) => b.id - a.id);
  const events = [...(eventsState.data ?? [])].reverse();
  const visibleEvents = activityFilter === "slashes"
    ? events.filter((event) => /slash/i.test(event.name) || "slashed" in event.payload)
    : events;
  const error = leasesState.error ?? eventsState.error;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-base font-semibold">Protocol state</h2><p className="mt-1 text-sm text-muted">Read-only indexed chain data. Newest records appear first.</p></div>
          <div className="mono text-xs text-faint">Events refresh every 3 seconds</div>
        </div>
        <div role="tablist" aria-label="Explorer sections" className="flex overflow-x-auto border-t border-line px-2 pt-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              onClick={() => setTab(item.id)}
              className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${tab === item.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div role="alert" className="rounded-md border border-danger/40 bg-panel px-4 py-3 text-sm text-danger">Some explorer data could not be refreshed. {error}</div>}

      <div id="panel-leases" role="tabpanel" aria-labelledby="tab-leases" hidden={tab !== "leases"}>
        <Card>
          <CardHead title="Rental leases" sub={`${leases.length} indexed`} />
          {leasesState.loading ? <Skeleton label="Loading leases" /> : leasesState.error ? <Empty title="Leases could not be loaded" hint="Check the orchestrator connection" /> : leases.length === 0 ? <Empty title="No leases recorded" hint="Lease requests and lifecycle state will appear here" /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[1080px] border-collapse"><thead><tr className="text-left text-[11px] uppercase tracking-wide text-faint"><th className="border-b border-line px-4 py-2.5 font-medium">Lease</th><th className="border-b border-line px-4 py-2.5 font-medium">Status</th><th className="border-b border-line px-4 py-2.5 font-medium">Requester</th><th className="border-b border-line px-4 py-2.5 font-medium">Provider</th><th className="border-b border-line px-4 py-2.5 font-medium">Service</th><th className="border-b border-line px-4 py-2.5 font-medium">Escrow / bond</th><th className="border-b border-line px-4 py-2.5 font-medium">Manifest</th></tr></thead><tbody>{leases.map((lease) => <tr key={lease.id} className="text-[13px] hover:bg-hover"><td className="mono border-b border-line px-4 py-3">#{lease.id}<small className="block text-faint">listing #{lease.listingId}</small></td><td className="border-b border-line px-4 py-3"><StatusTag status={lease.status} /></td><td className="border-b border-line px-4 py-3"><CopyValue value={lease.requester} label="requester address" /></td><td className="border-b border-line px-4 py-3"><CopyValue value={lease.provider} label="provider address" /></td><td className="mono border-b border-line px-4 py-3 text-xs text-muted">{lease.settledIntervals} settled · {lease.heartbeatedIntervals} heartbeats<small className="mt-1 block text-faint">{lease.fundedIntervals} funded</small></td><td className="mono border-b border-line px-4 py-3 text-xs">{fmtSmesh(lease.escrow)}<small className="mt-1 block text-faint">{fmtSmesh(lease.bond)} bond</small></td><td className="border-b border-line px-4 py-3"><ProtocolValue value={lease.manifest} label="manifest" /></td></tr>)}</tbody></table></div>
          )}
        </Card>
      </div>

      <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden={tab !== "activity"}>
        <Card>
          <CardHead title="Chronological activity" sub="Newest block and log first" action={<div className="flex rounded-md border border-line bg-bg p-0.5" aria-label="Activity filter">{(["all", "slashes"] as const).map((filter) => <button key={filter} type="button" aria-pressed={activityFilter === filter} onClick={() => setActivityFilter(filter)} className={`rounded-[4px] px-2.5 py-1 text-xs font-medium ${activityFilter === filter ? "bg-hover text-ink" : "text-muted hover:text-ink"}`}>{filter === "all" ? "All events" : "Slashes"}</button>)}</div>} />
          {eventsState.loading ? <Skeleton label="Loading event history" /> : eventsState.error ? <Empty title="Event history could not be loaded" hint="Check the orchestrator connection" /> : visibleEvents.length === 0 ? <Empty title={activityFilter === "slashes" ? "No slashing events recorded" : "No events indexed"} hint="Recent on-chain events will appear after the indexer catches up" /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[940px] border-collapse"><thead><tr className="text-left text-[11px] uppercase tracking-wide text-faint"><th className="border-b border-line px-4 py-2.5 font-medium">Position</th><th className="border-b border-line px-4 py-2.5 font-medium">Event</th><th className="border-b border-line px-4 py-2.5 font-medium">Details</th><th className="border-b border-line px-4 py-2.5 font-medium">Transaction</th></tr></thead><tbody>{visibleEvents.map((event) => <tr key={`${event.blockNumber}-${event.logIndex}-${event.transactionHash}`} className="align-top text-[13px] hover:bg-hover"><td className="mono whitespace-nowrap border-b border-line px-4 py-3">{event.blockNumber}<small className="ml-1 text-faint">:{event.logIndex}</small></td><td className={`mono border-b border-line px-4 py-3 text-xs font-medium ${/slash/i.test(event.name) ? "text-danger" : "text-ink2"}`}>{event.name}</td><td className="border-b border-line px-4 py-3"><div className="flex max-w-[620px] flex-wrap gap-x-4 gap-y-2">{Object.entries(event.payload).map(([key, value]) => { const text = payloadText(value); return <span key={key} className="inline-flex min-w-0 items-center gap-1.5"><span className="text-[11px] text-faint">{key}</span>{text.startsWith("0x") ? <CopyValue value={text} label={key} /> : <span className="mono max-w-[220px] truncate text-xs text-ink2" title={text}>{shortHash(text)}</span>}</span>; })}</div></td><td className="border-b border-line px-4 py-3"><CopyValue value={event.transactionHash} label="transaction hash" /></td></tr>)}</tbody></table></div>
          )}
        </Card>
      </div>
    </div>
  );
}
