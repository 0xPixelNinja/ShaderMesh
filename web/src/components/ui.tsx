"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { shortHash } from "@/lib/format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`min-w-0 max-w-full overflow-hidden rounded-lg border border-line bg-surface ${className}`}>{children}</section>;
}

export function CardHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {sub && <div className="mono mt-0.5 text-[11px] text-faint">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

export function GpuChip() {
  return (
    <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md border border-line bg-panel text-accent">
      <Icon name="gpu" className="h-4 w-4" />
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  Pending: "text-accent",
  Active: "text-success",
  Inactive: "text-muted",
  Serving: "text-success",
  Paid: "text-success",
  Completed: "text-success",
  Open: "text-accent",
  Claimed: "text-ink2",
  Submitted: "text-ink2",
  Disputed: "text-danger",
  Resolved: "text-muted",
  Ended: "text-muted",
  Terminated: "text-danger",
  Rejected: "text-danger",
  Cancelled: "text-muted",
  Ending: "text-accent",
  Down: "text-danger",
};

export function StatusTag({ status }: { status: string }) {
  const color = STATUS_STYLES[status] ?? "text-ink2";
  const dot =
    status === "Terminated" || status === "Rejected" || status === "Down" || status === "Disputed"
      ? "bg-danger"
      : status === "Pending" || status === "Ending" || status === "Open"
        ? "bg-accent"
        : status === "Ended" || status === "Cancelled" || status === "Inactive" || status === "Resolved"
          ? "bg-muted"
          : "bg-success";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium ${color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  );
}

/** A compact uptime heartbeat strip. `up` beats out of `total`, trailing one pulsing. */
export function Heartbeats({ up, total = 8 }: { up: number; total?: number }) {
  return (
    <span className="inline-flex gap-[2px]">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-4 w-1 rounded-[1px] ${i < up ? "bg-success/85" : "bg-panel"}`}
        />
      ))}
    </span>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint && <p className="mono mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function RepBar({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel">
        <span className="block h-full bg-success" style={{ width: `${score}%` }} />
      </span>
      <span className="mono w-7 text-right text-[11px] text-muted">{score}</span>
    </span>
  );
}

export function CopyValue({ value, label = "value" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="mono truncate text-xs" title={value}>{shortHash(value)}</span>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-md border border-line px-1.5 py-1 text-[10px] font-medium text-muted hover:border-line-strong hover:bg-hover hover:text-ink"
        aria-label={`Copy ${label}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
