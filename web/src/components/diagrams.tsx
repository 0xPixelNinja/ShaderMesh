"use client";

import type { ReactNode } from "react";
import type { Challenge, LeaseStatus } from "@/lib/types";

/*
 * Protocol diagrams. Inline SVG drawn only with design tokens, so both themes
 * render from the same markup. Motion conveys state: the current lease state is
 * lit, the live payout edge carries flowing dashes, and new heartbeats tick in.
 */

/** A captioned figure, numbered like a technical report. */
export function Figure({ n, caption, children }: { n?: number; caption: ReactNode; children: ReactNode }) {
  return (
    <figure className="min-w-0">
      <div className="overflow-x-auto">{children}</div>
      <figcaption className="mt-3 text-[13px] leading-snug text-faint">
        {n !== undefined && <span className="mr-2 font-medium text-muted">Fig. {n}</span>}
        {caption}
      </figcaption>
    </figure>
  );
}

/* ----------------------------------------------------------- lease lifecycle */

const LIFECYCLE_NODES: { id: LeaseStatus; x: number; y: number; note: string }[] = [
  { id: "Pending", x: 20, y: 52, note: "escrow locked" },
  { id: "Active", x: 220, y: 52, note: "bond held, streaming" },
  { id: "Ended", x: 420, y: 52, note: "settled, bond released" },
  { id: "Rejected", x: 20, y: 150, note: "full refund" },
  { id: "Cancelled", x: 120, y: 150, note: "full refund" },
  { id: "Terminated", x: 320, y: 150, note: "downtime slash" },
];

const LIFECYCLE_EDGES: [LeaseStatus, LeaseStatus][] = [
  ["Pending", "Active"],
  ["Active", "Ended"],
  ["Pending", "Rejected"],
  ["Pending", "Cancelled"],
  ["Active", "Terminated"],
];

const NODE_W = 160;
const NODE_H = 52;
const SMALL_W = 90;

function nodeBox(id: LeaseStatus) {
  const n = LIFECYCLE_NODES.find((node) => node.id === id)!;
  const small = n.y > 100;
  const w = small ? (id === "Terminated" ? NODE_W : SMALL_W) : NODE_W;
  return { ...n, w, h: small ? 44 : NODE_H };
}

/** The lease state machine with the given status lit. */
export function LeaseLifecycle({ status }: { status?: LeaseStatus | null }) {
  const reached = new Set<LeaseStatus>(status ? ["Pending", status] : []);
  if (status === "Ended" || status === "Terminated") reached.add("Active");

  return (
    <svg
      viewBox="0 0 600 210"
      role="img"
      aria-label={`Lease lifecycle${status ? `, current state ${status}` : ""}`}
      className="h-auto w-full min-w-[520px] text-[13px]"
    >
      <defs>
        <marker id="lc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="var(--border-strong)" />
        </marker>
        <marker id="lc-arrow-on" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="var(--accent)" />
        </marker>
      </defs>

      {LIFECYCLE_EDGES.map(([from, to]) => {
        const a = nodeBox(from);
        const b = nodeBox(to);
        const on = reached.has(from) && reached.has(to);
        const horizontal = a.y === b.y;
        const d = horizontal
          ? `M${a.x + a.w} ${a.y + a.h / 2} L${b.x - 6} ${b.y + b.h / 2}`
          : `M${Math.min(Math.max(b.x + b.w / 2, a.x + 16), a.x + a.w - 16)} ${a.y + a.h} L${Math.min(Math.max(b.x + b.w / 2, a.x + 16), a.x + a.w - 16)} ${b.y - 6}`;
        return (
          <path
            key={`${from}-${to}`}
            d={d}
            fill="none"
            strokeWidth={on ? 2 : 1.25}
            style={{ stroke: on ? "var(--accent)" : "var(--border-strong)", transition: "stroke var(--dur) var(--ease-out)" }}
            markerEnd={on ? "url(#lc-arrow-on)" : "url(#lc-arrow)"}
          />
        );
      })}

      {LIFECYCLE_NODES.map((n) => {
        const box = nodeBox(n.id);
        const current = n.id === status;
        const past = reached.has(n.id) && !current;
        return (
          <g key={n.id} aria-current={current ? "step" : undefined}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={6}
              strokeWidth={current ? 2 : 1}
              style={{
                fill: current ? "var(--accent-weak)" : "var(--surface)",
                stroke: current ? "var(--accent)" : past ? "var(--ink2)" : "var(--border-strong)",
                transition: "fill var(--dur) var(--ease-out), stroke var(--dur) var(--ease-out)",
              }}
            />
            <text
              x={box.x + 12}
              y={box.y + (box.h > 44 ? 22 : 19)}
              style={{ fill: current ? "var(--accent-text)" : "var(--ink)" }}
              fontWeight={600}
            >
              {n.id}
            </text>
            <text x={box.x + 12} y={box.y + (box.h > 44 ? 39 : 34)} style={{ fill: "var(--faint)" }} fontSize={12}>
              {n.note}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------------------------------------------------------- token flow */

export interface FlowAmounts {
  escrowed: string;
  paid: string;
  refunded: string;
  slashed: string;
  treasury?: string;
}

const TONE_ID: Record<string, string> = {
  "var(--ink2)": "ink",
  "var(--success)": "success",
  "var(--muted)": "muted",
  "var(--danger)": "danger",
};

/**
 * Where SMESH moves: requester deposits into escrow, escrow streams to the
 * provider per settled interval, unused escrow returns to the requester, and
 * slashes leave provider stake for the requester (downtime) or the treasury
 * (failed benchmark challenge).
 */
export function TokenFlow({ amounts, live = false }: { amounts: FlowAmounts; live?: boolean }) {
  const W = 150;
  const H = 56;
  const Y = 60;
  const boxes = [
    { id: "requester", label: "Requester", sub: "pays per interval", x: 10, y: Y },
    { id: "escrow", label: "Escrow", sub: "RentalMarket", x: 285, y: Y },
    { id: "provider", label: "Provider", sub: "stake and bond", x: 560, y: Y },
    { id: "treasury", label: "Treasury", sub: "challenge slashes", x: 560, y: 236 },
  ];
  const mid = Y + H / 2;

  // Label sits above the edge, amount below it, both centred on (x, y).
  const edge = (
    label: string,
    value: string,
    d: string,
    tone: string,
    x: number,
    y: number,
    anchor: "middle" | "end" = "middle",
    flowing = false,
  ) => (
    <g>
      <path d={d} fill="none" strokeWidth={1.5} style={{ stroke: tone }} markerEnd={`url(#tf-${TONE_ID[tone]})`} className={flowing ? "flow-edge" : undefined} />
      <text x={x} y={y - 8} fontSize={12} textAnchor={anchor} style={{ fill: "var(--faint)" }}>
        {label}
      </text>
      <text x={x} y={y + 18} fontSize={13} textAnchor={anchor} className="mono" fontWeight={600} style={{ fill: tone }}>
        {value}
      </text>
    </g>
  );

  return (
    <svg
      viewBox="0 0 720 300"
      role="img"
      aria-label={`Token flow. Escrowed ${amounts.escrowed}, paid ${amounts.paid}, refunded ${amounts.refunded}, slashed ${amounts.slashed}`}
      className="h-auto w-full min-w-[520px] text-[13px]"
    >
      <defs>
        {Object.entries(TONE_ID).map(([tone, id]) => (
          <marker key={id} id={`tf-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L8 4L0 8z" style={{ fill: tone }} />
          </marker>
        ))}
      </defs>

      {edge("deposit", amounts.escrowed, `M${10 + W} ${mid} L${285 - 4} ${mid}`, "var(--ink2)", 222, mid)}
      {edge("streamed", amounts.paid, `M${285 + W} ${mid} L${560 - 4} ${mid}`, "var(--success)", 497, mid, "middle", live)}
      {edge("refunded", amounts.refunded, `M320 ${Y + H} C320 190, 85 190, 85 ${Y + H + 4}`, "var(--muted)", 200, 196)}
      {edge("downtime slash", amounts.slashed, `M600 ${Y + H} C600 190, 400 190, 400 ${Y + H + 4}`, "var(--danger)", 490, 196)}
      {amounts.treasury !== undefined &&
        edge("challenge slash", amounts.treasury, `M675 ${Y + H} L675 ${236 - 4}`, "var(--danger)", 664, 196, "end")}

      {boxes.map((b) =>
        b.id === "treasury" && amounts.treasury === undefined ? null : (
          <g key={b.id}>
            <rect
              x={b.x}
              y={b.y}
              width={W}
              height={H}
              rx={6}
              strokeWidth={b.id === "escrow" && live ? 2 : 1}
              style={{ fill: "var(--surface)", stroke: b.id === "escrow" && live ? "var(--accent)" : "var(--border-strong)" }}
            />
            <text x={b.x + 12} y={b.y + 23} fontWeight={600} style={{ fill: "var(--ink)" }}>
              {b.label}
            </text>
            <text x={b.x + 12} y={b.y + 41} fontSize={12} style={{ fill: "var(--faint)" }}>
              {b.sub}
            </text>
          </g>
        ),
      )}
    </svg>
  );
}

/* ---------------------------------------------------------- escrow intervals */

/**
 * One cell per interval of a lease. Settled cells have paid the provider,
 * attested cells carry a heartbeat awaiting settlement, funded cells are still
 * held in escrow, and the rest are the unfunded headroom up to the maximum.
 */
export function EscrowIntervals({
  funded,
  heartbeated,
  settled,
  max,
  current,
}: {
  funded: number;
  heartbeated: number;
  settled: number;
  max: number;
  current?: number | null;
}) {
  const total = Math.max(max, funded, 1);
  // Long listings can allow hundreds of intervals; draw a short run of headroom.
  const drawn = Math.min(total, Math.max(funded, 1) + 8);
  const cells = Array.from({ length: drawn }, (_, i) => {
    if (i < settled) return "settled";
    if (i < heartbeated) return "attested";
    if (i < funded) return "funded";
    return "headroom";
  });
  const style: Record<string, string> = {
    settled: "bg-success border-success",
    attested: "bg-accent border-accent",
    funded: "bg-panel border-line-strong",
    headroom: "border-dashed border-line-strong bg-transparent",
  };

  return (
    <div>
      <ol className="flex flex-wrap gap-1" aria-label={`${settled} of ${funded} funded intervals settled`}>
        {cells.map((kind, i) => (
          <li
            key={i}
            title={`Interval ${i + 1}: ${kind}`}
            className={`relative h-6 w-4 rounded-[3px] border transition-colors duration ease-out ${style[kind]}`}
          >
            {current === i && <span className="absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" aria-hidden />}
          </li>
        ))}
        {drawn < total && (
          <li className="self-center pl-1 text-[12px] text-faint">+{total - drawn} more</li>
        )}
      </ol>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted">
        <Legend swatch="bg-success border-success" label={`settled ${settled}`} />
        <Legend swatch="bg-accent border-accent" label={`heartbeat, unsettled ${Math.max(heartbeated - settled, 0)}`} />
        <Legend swatch="bg-panel border-line-strong" label={`in escrow ${Math.max(funded - heartbeated, 0)}`} />
        <Legend swatch="border-dashed border-line-strong" label={`extendable ${Math.max(total - funded, 0)}`} />
      </ul>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-2 rounded-[2px] border ${swatch}`} aria-hidden />
      {label}
    </li>
  );
}

/* ---------------------------------------------------------- heartbeat strip */

/**
 * Uptime evidence per elapsed interval: a tall amber bar for a signed
 * heartbeat, a short red stub for a missed interval, and the live interval
 * marked with the indicator dot.
 */
export function HeartbeatStrip({ elapsed, beats, live = false }: { elapsed: number; beats: number; live?: boolean }) {
  const shown = Math.max(elapsed, 1);
  const missed = Math.max(elapsed - beats, 0);
  return (
    <div>
      <div className="flex h-10 items-end gap-[3px]" role="img" aria-label={`${beats} heartbeats over ${elapsed} intervals, ${missed} missed`}>
        {Array.from({ length: shown }, (_, i) => {
          const up = i < beats;
          return (
            <span
              key={i}
              className={`tick-in w-[6px] rounded-[2px] ${up ? "h-full bg-accent" : "h-2 bg-danger"}`}
              style={{ animationDelay: `calc(${Math.min(i, 12)} * var(--stagger))` }}
            />
          );
        })}
        {live && (
          <span className="ml-2 inline-flex items-center gap-1.5 self-center text-[12px] text-muted">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            live
          </span>
        )}
      </div>
      <p className="mt-2 text-[12px] text-faint">
        <span className="mono text-ink2">{beats}</span> signed of <span className="mono text-ink2">{elapsed}</span>{" "}
        elapsed intervals{missed > 0 && <span className="text-danger">, {missed} missed</span>}
      </p>
    </div>
  );
}

/* ----------------------------------------------------------- challenge track */

const CHALLENGE_TONE: Record<Challenge["status"], { mark: string; label: string }> = {
  open: { mark: "border-accent bg-accent-weak", label: "open" },
  responded: { mark: "border-accent bg-accent", label: "answered" },
  passed: { mark: "border-success bg-success", label: "passed" },
  failed: { mark: "border-danger bg-danger", label: "failed, slashed" },
  lapsed: { mark: "border-line-strong bg-panel", label: "lapsed" },
};

/** Recent benchmark challenges for one or more providers, oldest first. */
export function ChallengeTrack({ challenges, limit = 24 }: { challenges: Challenge[]; limit?: number }) {
  const recent = [...challenges].sort((a, b) => a.id - b.id).slice(-limit);
  const passed = recent.filter((c) => c.status === "passed").length;
  const failed = recent.filter((c) => c.status === "failed").length;
  return (
    <div>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label={`${recent.length} recent challenges, ${passed} passed, ${failed} failed`}>
        {recent.map((c) => (
          <li
            key={c.id}
            title={`Challenge ${c.id}: ${CHALLENGE_TONE[c.status].label}${c.score ? `, score ${c.score}` : ""}`}
            className={`h-3.5 w-3.5 rounded-[3px] border transition-colors duration ease-out ${CHALLENGE_TONE[c.status].mark}`}
          />
        ))}
        {recent.length === 0 && <li className="text-[13px] text-faint">No challenges issued yet.</li>}
      </ol>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted">
        {(["passed", "failed", "open", "lapsed"] as const).map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-[2px] border ${CHALLENGE_TONE[s].mark}`} aria-hidden />
            {CHALLENGE_TONE[s].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
