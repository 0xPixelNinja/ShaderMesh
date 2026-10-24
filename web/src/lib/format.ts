import { formatUnits } from "viem";

/** Token base units (18 decimals) to a USD number, at the 1 SMESH = $1 peg. */
export function usd(wei: string | bigint): number {
  try {
    return Number(formatUnits(BigInt(wei), 18));
  } catch {
    return 0;
  }
}

/** USD string, for example $0.42. */
export function fmtUsd(wei: string | bigint, digits = 2): string {
  return (
    "$" +
    usd(wei).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  );
}

/** A token amount without its unit, for places that print "SMESH" separately. */
export function fmtAmount(wei: string | bigint, digits = 2): string {
  return usd(wei).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** SMESH amount with its unit. Use this everywhere a value is shown. */
export function fmtSmesh(wei: string | bigint, digits = 2): string {
  return (
    usd(wei).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }) + " SMESH"
  );
}

export function shortAddr(a?: string | null): string {
  if (!a) return "";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function shortHash(value?: string | null): string {
  if (!value) return "";
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

/** Reputation is stored 0..10000; show it as 0..100. */
export function repScore(r: number): number {
  return Math.round(r / 100);
}

export function fmtInterval(secs: number): string {
  if (!secs) return "-";
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}
