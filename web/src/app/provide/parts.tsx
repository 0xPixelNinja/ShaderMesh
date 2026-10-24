"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button, CopyValue, ErrorNote, SubNav } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { TxNoticeState } from "./useProvider";

const NAV = [
  { href: "/provide", label: "Node" },
  { href: "/provide/capacity", label: "Capacity" },
  { href: "/provide/stake", label: "Stake" },
];

export function ProvideNav({ current }: { current: string }) {
  return <SubNav items={NAV} current={current} />;
}

export const textareaClass =
  "mono block w-full resize-y rounded-md border border-line bg-bg px-2.5 py-2 text-[12px] leading-relaxed text-ink transition-colors duration-fast ease-out placeholder:text-faint hover:border-line-strong disabled:opacity-45";

/** A link styled as a button, for steps that continue on another page. */
export function LinkButton({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors duration-fast ease-out ${
        primary
          ? "border-accent bg-accent text-accent-ink hover:border-accent-hover hover:bg-accent-hover"
          : "border-line bg-panel text-ink2 hover:border-line-strong hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
      <Icon name="arrow" className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/**
 * Transaction progress. The live region stays mounted so screen readers hear
 * each step; failures are raised as alerts.
 */
export function TxNotice({ notice }: { notice: TxNoticeState | null }) {
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {notice && !notice.error && (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-3 text-[13px] text-ink2">
          <span>{notice.text}</span>
          {notice.hash && <CopyValue value={notice.hash} label="transaction hash" />}
        </div>
      )}
      {notice?.error && (
        <div className="mb-8">
          <ErrorNote>{notice.text}</ErrorNote>
        </div>
      )}
    </div>
  );
}

export function ApiWarning({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mb-8">
      <ErrorNote>Provider data could not be fully refreshed. {error}</ErrorNote>
    </div>
  );
}

/** Shown in place of the workspace when no wallet is connected. */
export function ConnectPrompt({ connect, connecting, what }: { connect: () => void; connecting: boolean; what: string }) {
  return (
    <div className="flex flex-col items-start gap-4 border-b border-line pb-8 pt-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-[52ch]">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Connect your provider wallet</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{what}</p>
      </div>
      <Button variant="primary" icon="wallet" onClick={connect} loading={connecting}>
        Connect wallet
      </Button>
    </div>
  );
}

/** The reason a form is disabled, shown next to its submit button. */
export function Reason({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-start gap-1.5 text-[13px] leading-relaxed text-muted">
      <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      {children}
    </p>
  );
}

/** A form row: helper or reason on the left, the submit action on the right. */
export function FormFooter({ reason, children }: { reason?: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">{reason && <Reason>{reason}</Reason>}</div>
      <div className="flex shrink-0 gap-2">{children}</div>
    </div>
  );
}
