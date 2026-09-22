"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import {
  Card,
  CardHead,
  CopyValue,
  Empty,
  ErrorNote,
  Heartbeats,
  Skeleton,
  StatusTag,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { fmtSmesh, shortHash } from "@/lib/format";
import type { ChainEvent, JsonValue, Lease } from "@/lib/types";

type Tab = "leases" | "activity";

const TABS: { id: Tab; label: string }[] = [
  { id: "leases", label: "Leases" },
  { id: "activity", label: "Events and slashes" },
];

function ProtocolValue({ value, label }: { value: string | null; label: string }) {
  if (!value) return <span className="text-faint">None</span>;
  if (value.startsWith("0x")) return <CopyValue value={value} label={label} />;
  return (
    <span className="mono block max-w-[240px] truncate text-[13px] text-muted" title={value}>
      {shortHash(value)}
    </span>
  );
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
  const visibleEvents =
    activityFilter === "slashes"
      ? events.filter((event) => /slash/i.test(event.name) || "slashed" in event.payload)
      : events;

  const error = leasesState.error ?? eventsState.error;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Protocol state</h2>
            <p className="mt-1 text-[13px] text-muted">
              Read-only data indexed from the chain. Newest records first.
            </p>
          </div>
          <div className="text-[13px] text-faint">Events refresh every 3 seconds</div>
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
                tab === item.id
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote>Some explorer data could not be refreshed. {error}</ErrorNote>}

      <div id="panel-leases" role="tabpanel" aria-labelledby="tab-leases" hidden={tab !== "leases"}>
        <Card>
          <CardHead title="Rental leases" sub={`${leases.length} indexed`} />
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse">
                <thead>
                  <tr>
                    <Th>Lease</Th>
                    <Th>Status</Th>
                    <Th>Requester</Th>
                    <Th>Provider</Th>
                    <Th>Uptime</Th>
                    <Th align="right">Escrow / bond</Th>
                    <Th>Manifest</Th>
                  </tr>
                </thead>
                <tbody>
                  {leases.map((lease) => (
                    <Tr key={lease.id}>
                      <Td className="mono">
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
                      <Td>
                        <Heartbeats
                          up={lease.heartbeatedIntervals}
                          total={Math.min(Math.max(lease.fundedIntervals, 1), 10)}
                          live={lease.status === "Active"}
                        />
                        <span className="mono mt-1 block text-[12px] text-faint">
                          {lease.settledIntervals} settled of {lease.fundedIntervals}
                        </span>
                      </Td>
                      <Td align="right" className="mono">
                        {fmtSmesh(lease.escrow)}
                        <span className="block text-[12px] text-faint">{fmtSmesh(lease.bond)} bond</span>
                      </Td>
                      <Td>
                        <ProtocolValue value={lease.manifest} label="manifest" />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden={tab !== "activity"}>
        <Card>
          <CardHead
            title="Chronological activity"
            sub="Newest block and log index first"
            action={
              <div className="flex rounded-md border border-line bg-bg p-0.5" aria-label="Activity filter">
                {(["all", "slashes"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={activityFilter === filter}
                    onClick={() => setActivityFilter(filter)}
                    className={`rounded-[4px] px-3 py-1.5 text-[13px] font-medium transition-colors duration-fast ease-out ${
                      activityFilter === filter ? "bg-hover text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {filter === "all" ? "All events" : "Slashes"}
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
              title={activityFilter === "slashes" ? "No slashing events recorded" : "No events indexed"}
              hint="On-chain events appear here once the indexer catches up with the latest block."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] border-collapse">
                <thead>
                  <tr>
                    <Th>Position</Th>
                    <Th>Event</Th>
                    <Th>Details</Th>
                    <Th>Transaction</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((event) => (
                    <Tr key={`${event.blockNumber}-${event.logIndex}-${event.transactionHash}`}>
                      <Td className="mono whitespace-nowrap align-top">
                        {event.blockNumber}
                        <span className="ml-1 text-faint">:{event.logIndex}</span>
                      </Td>
                      <Td
                        className={`mono align-top font-medium ${
                          /slash/i.test(event.name) ? "text-danger" : "text-ink2"
                        }`}
                      >
                        {event.name}
                      </Td>
                      <Td className="align-top">
                        <div className="flex max-w-[620px] flex-wrap gap-x-4 gap-y-2">
                          {Object.entries(event.payload).map(([key, value]) => {
                            const text = payloadText(value);
                            return (
                              <span key={key} className="inline-flex min-w-0 items-center gap-1.5">
                                <span className="text-[12px] text-faint">{key}</span>
                                {text.startsWith("0x") ? (
                                  <CopyValue value={text} label={key} />
                                ) : (
                                  <span className="mono max-w-[220px] truncate text-[13px] text-ink2" title={text}>
                                    {shortHash(text)}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </Td>
                      <Td className="align-top">
                        <CopyValue value={event.transactionHash} label="transaction hash" />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
