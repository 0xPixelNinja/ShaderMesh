import { fmtSmesh, shortAddr } from "./format";
import type { ChainEvent } from "./types";

/*
 * Plain-English event model shared by the explorer timeline and the home
 * activity feed. Kinds drive the dot colour; describe() covers the events a
 * reviewer cares about and returns null for the rest.
 */

function big(value: string | number | null | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

export type Kind = "lease" | "settle" | "challenge" | "slash" | "registry";

export const KIND_STYLE: Record<Kind, { dot: string; label: string }> = {
  lease: { dot: "bg-ink2", label: "Lease" },
  settle: { dot: "bg-success", label: "Payment" },
  challenge: { dot: "bg-accent", label: "Challenge" },
  slash: { dot: "bg-danger", label: "Slash" },
  registry: { dot: "bg-faint", label: "Registry" },
};

export function isSlash(event: ChainEvent): boolean {
  if (/slash|Terminated|AttestationRevoked/i.test(event.name)) return true;
  return event.name === "ChallengeResolved" && big(event.payload.slashed as string) > 0n;
}

export function kindOf(event: ChainEvent): Kind {
  if (isSlash(event)) return "slash";
  if (/^Challenge|^Attest/.test(event.name)) return "challenge";
  if (/Settled|Paid|Credit/.test(event.name)) return "settle";
  if (/Lease|Listing|Heartbeat/.test(event.name)) return "lease";
  return "registry";
}

const CHALLENGE_STATUS: Record<string, string> = { "3": "passed", "4": "failed", "5": "lapsed" };

/** A one-line description of an event in plain English, when it is a known one. */
export function describe(event: ChainEvent): string | null {
  const p = event.payload as Record<string, string>;
  const who = shortAddr(p.provider ?? p.who);
  const lease = p.leaseId ?? p.id;
  switch (event.name) {
    case "LeaseRequested":
      return `Lease ${lease} requested, escrow locked`;
    case "LeaseAccepted":
      return `Lease ${lease} accepted by ${who}, bond held`;
    case "Heartbeat":
      return `Lease ${lease} heartbeat for interval ${p.interval}`;
    case "IntervalSettled":
      return `Lease ${lease} paid ${fmtSmesh(p.amount ?? "0")} for ${p.intervals} interval(s)`;
    case "LeaseEnded":
      return `Lease ${lease} ended and settled`;
    case "LeaseTerminated":
      return `Lease ${lease} terminated for downtime`;
    case "LeaseRejected":
    case "LeaseCancelled":
      return `Lease ${lease} ${event.name === "LeaseRejected" ? "rejected" : "cancelled"}, escrow refunded`;
    case "Slashed":
      return `${who} slashed ${fmtSmesh(p.amount ?? "0")} to ${shortAddr(p.beneficiary)}`;
    case "ChallengeIssued":
      return `Challenge ${p.id} issued to ${who}`;
    case "ChallengeResponded":
      return `Challenge ${p.id} answered with score ${p.score}`;
    case "ChallengeResolved":
      return `Challenge ${p.id} ${CHALLENGE_STATUS[p.status] ?? "resolved"}${big(p.slashed) > 0n ? `, ${fmtSmesh(p.slashed)} slashed` : ""}`;
    case "AttestationRevoked":
      return `Attestation revoked for ${who}`;
    case "Attested":
      return `${who} attested as ${p.gpuModel}`;
    default:
      return null;
  }
}

export function timeAgo(ts?: number | null): string {
  if (!ts) return "";
  const s = Math.max(Math.floor(Date.now() / 1000) - ts, 0);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
