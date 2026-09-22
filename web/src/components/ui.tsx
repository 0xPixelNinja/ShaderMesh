"use client";

import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { shortHash } from "@/lib/format";

/* ------------------------------------------------------------------ surfaces */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 max-w-full overflow-hidden rounded-lg border border-line bg-surface ${className}`}>
      {children}
    </section>
  );
}

export function CardHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold leading-tight text-ink">{title}</h3>
        {sub && <p className="mt-1 text-[13px] leading-tight text-muted">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A labelled figure. Used for the small number strips at the top of a page. */
export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "accent" | "success";
}) {
  const valueTone =
    tone === "accent" ? "text-accent" : tone === "success" ? "text-success" : "text-ink";
  return (
    <div className="px-5 py-4">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className={`mono mt-1.5 text-[26px] font-semibold leading-none tracking-tight ${valueTone}`}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[13px] leading-tight text-faint">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- actions */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent text-accent-ink hover:bg-accent-hover hover:border-accent-hover",
  secondary:
    "border-line bg-panel text-ink2 hover:bg-hover hover:text-ink hover:border-line-strong",
  ghost:
    "border-transparent bg-transparent text-muted hover:bg-hover hover:text-ink",
  danger:
    "border-line bg-danger-weak text-danger hover:border-danger/50 hover:bg-danger/15",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  children,
  className = "",
  disabled,
  ...props
}: {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: IconName;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizing = size === "sm" ? "h-8 gap-1.5 px-2.5 text-[13px]" : "h-9 gap-2 px-3.5 text-[13px]";
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border font-medium transition-colors duration-fast ease-out disabled:pointer-events-none disabled:opacity-45 ${sizing} ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70"
    />
  );
}

/* -------------------------------------------------------------------- inputs */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink2">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-[13px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[13px] text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className = "", invalid, ...props }: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={`h-9 w-full rounded-md border bg-bg px-2.5 text-[13px] text-ink transition-colors duration-fast ease-out placeholder:text-faint hover:border-line-strong disabled:opacity-45 ${
        invalid ? "border-danger" : "border-line"
      } ${className}`}
    />
  );
}

/* --------------------------------------------------------------------- state */

const STATUS_TONES: Record<string, string> = {
  Pending: "accent",
  Open: "accent",
  Ending: "accent",
  Claimed: "accent",
  Active: "success",
  Serving: "success",
  Paid: "success",
  Completed: "success",
  Submitted: "success",
  Disputed: "danger",
  Terminated: "danger",
  Rejected: "danger",
  Down: "danger",
  Inactive: "neutral",
  Resolved: "neutral",
  Ended: "neutral",
  Cancelled: "neutral",
};

const TONE_STYLES: Record<string, { wrap: string; dot: string }> = {
  accent: { wrap: "border-accent/30 bg-accent-weak text-accent", dot: "bg-accent" },
  success: { wrap: "border-success/25 bg-success-weak text-success", dot: "bg-success" },
  danger: { wrap: "border-danger/30 bg-danger-weak text-danger", dot: "bg-danger" },
  neutral: { wrap: "border-line bg-panel text-muted", dot: "bg-faint" },
};

export function StatusTag({ status }: { status: string }) {
  const tone = TONE_STYLES[STATUS_TONES[status] ?? "neutral"];
  const live = status === "Active" || status === "Serving";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium ${tone.wrap}`}
    >
      <span className={`relative h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`}>
        {live && (
          <span className={`absolute inset-0 animate-ping rounded-full opacity-60 ${tone.dot}`} />
        )}
      </span>
      {status}
    </span>
  );
}

/** Uptime strip. `up` beats out of `total`; the newest beat pulses while live. */
export function Heartbeats({ up, total = 10, live = false }: { up: number; total?: number; live?: boolean }) {
  const filled = Math.max(0, Math.min(total, up));
  return (
    <span
      className="inline-flex items-end gap-[3px]"
      role="img"
      aria-label={`${filled} of the last ${total} intervals confirmed`}
      title={`${filled}/${total} intervals confirmed`}
    >
      {Array.from({ length: total }).map((_, i) => {
        const on = i < filled;
        const newest = on && i === filled - 1;
        return (
          <span
            key={i}
            className={`w-[3px] rounded-[1px] transition-all duration-fast ease-out ${
              on ? "h-5 bg-success" : "h-3 bg-line-strong"
            } ${newest && live ? "animate-pulse" : ""}`}
          />
        );
      })}
    </span>
  );
}

export function RepBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const tone = pct >= 70 ? "bg-success" : pct >= 40 ? "bg-accent" : "bg-danger";
  return (
    <span className="inline-flex items-center gap-2.5" title={`Reputation ${pct} of 100`}>
      <span className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-panel ring-1 ring-inset ring-line">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="mono w-6 text-right text-[13px] tabular-nums text-ink2">{pct}</span>
    </span>
  );
}

export function GpuChip({ live = false }: { live?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-panel ${
        live ? "border-accent/40 text-accent" : "border-line text-muted"
      }`}
    >
      <Icon name="gpu" className="h-[18px] w-[18px]" />
    </span>
  );
}

/* -------------------------------------------------------- empty and loading */

export function Empty({
  title,
  hint,
  icon = "inbox",
  action,
}: {
  title: string;
  hint?: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-lg border border-line bg-panel text-faint">
        <Icon name={icon} className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-[14px] font-medium text-ink2">{title}</p>
      {hint && <p className="mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-2.5 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-panel" />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- data values */

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
    <span className="group inline-flex max-w-full items-center gap-1.5">
      <span className="mono truncate text-[13px] text-ink2" title={value}>
        {shortHash(value)}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-transparent text-faint transition-colors duration-fast ease-out hover:border-line hover:bg-hover hover:text-ink"
      >
        <Icon name={copied ? "check" : "copy"} className={`h-3.5 w-3.5 ${copied ? "text-success" : ""}`} aria-hidden />
      </button>
    </span>
  );
}

/** An inline notice. Used for wallet prompts and protocol caveats, not errors. */
export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  const styles =
    tone === "accent"
      ? "border-accent/30 bg-accent-weak text-ink2"
      : "border-line bg-panel text-muted";
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-[13px] leading-relaxed ${styles}`}>
      <Icon name="shield" className="mt-px h-4 w-4 shrink-0 text-faint" aria-hidden />
      <p className="min-w-0">{children}</p>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-danger/40 bg-danger-weak px-4 py-3 text-[13px] leading-relaxed text-danger"
    >
      <Icon name="alert" className="mt-px h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0">{children}</p>
    </div>
  );
}

/* --------------------------------------------------------------------- table */

export function Th({ children, align = "left", className = "" }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap border-b border-line px-5 py-2.5 text-[12px] font-medium uppercase tracking-wide text-faint ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className = "" }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return (
    <td
      className={`border-b border-line px-5 py-3.5 text-[13px] align-middle ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="transition-colors duration-fast ease-out hover:bg-hover">{children}</tr>;
}
