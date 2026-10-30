"use client";

import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "./icons";
import { shortHash } from "@/lib/format";
import { copyText } from "@/lib/browser";

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
        <h3 className="text-[15px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h3>
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
      <div className={`mono mt-1.5 text-[24px] font-semibold leading-none tracking-tight ${valueTone}`}>
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
    "border-line bg-danger-weak text-danger hover:border-danger",
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
  accent: { wrap: "border-accent bg-accent-weak text-accent", dot: "bg-accent" },
  success: { wrap: "border-success bg-success-weak text-success", dot: "bg-success" },
  danger: { wrap: "border-danger bg-danger-weak text-danger", dot: "bg-danger" },
  neutral: { wrap: "border-line bg-panel text-muted", dot: "bg-faint" },
};

export function StatusTag({ status }: { status: string }) {
  const tone = TONE_STYLES[STATUS_TONES[status] ?? "neutral"];
  const live = status === "Active" || status === "Serving";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium ${tone.wrap}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot} ${live ? "live-dot" : ""}`} />
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
            className={`w-[3px] rounded-[1px] transition-colors duration-fast ease-out ${
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
        live ? "border-accent text-accent" : "border-line text-muted"
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
    const ok = await copyText(value);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1600);
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
      ? "border-accent bg-accent-weak text-ink2"
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
      className="flex items-start gap-2.5 rounded-lg border border-danger bg-danger-weak px-4 py-3 text-[13px] leading-relaxed text-danger"
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
      className={`whitespace-nowrap border-b border-line px-5 py-3 text-[12px] font-medium uppercase tracking-wide text-faint ${
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
      className={`border-b border-line px-5 py-3 text-[13px] align-middle ${
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

/* ---------------------------------------------------------- page structure */

/** The top of every app page: workspace label, title, one-line purpose, actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-[44rem]">
        {eyebrow && <p className="mb-2 text-[13px] font-medium text-accent">{eyebrow}</p>}
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="mt-2 text-[15px] leading-[1.6] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * A titled region without a card border. Sections separate content with space
 * and one hairline; cards are reserved for objects (a lease, a listing).
 */
export function Section({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line pb-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Label and value pairs in a responsive grid. Values are mono by default. */
export function Facts({
  items,
  columns = 4,
}: {
  items: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "success" | "danger" | "accent" }[];
  columns?: 2 | 3 | 4;
}) {
  const cols = columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4";
  const tone = { default: "text-ink", success: "text-success", danger: "text-danger", accent: "text-accent" };
  return (
    <dl className={`grid grid-cols-1 gap-x-8 gap-y-5 ${cols}`}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[13px] text-muted">{item.label}</dt>
          <dd className={`mono mt-1.5 truncate text-[20px] font-semibold leading-tight ${tone[item.tone ?? "default"]}`}>
            {item.value}
          </dd>
          {item.sub && <dd className="mt-1 text-[12px] text-faint">{item.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A horizontal bar split into labelled parts, for example bonded and free stake. */
export function Meter({
  parts,
  label,
}: {
  parts: { value: number; label: string; tone: "accent" | "success" | "danger" | "muted" | "ink" }[];
  label: string;
}) {
  const total = parts.reduce((sum, p) => sum + Math.max(p.value, 0), 0) || 1;
  const fill = { accent: "bg-accent", success: "bg-success", danger: "bg-danger", muted: "bg-line-strong", ink: "bg-ink2" };
  return (
    <div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-[3px] bg-panel" role="img" aria-label={label}>
        {parts.map((p) =>
          p.value > 0 ? (
            <span key={p.label} className={`h-full ${fill[p.tone]}`} style={{ width: `${(p.value / total) * 100}%` }} />
          ) : null,
        )}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
        {parts.map((p) => (
          <li key={p.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-[2px] ${fill[p.tone]}`} aria-hidden />
            {p.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Setup steps with done, current, and upcoming states. */
export function Checklist({ steps }: { steps: { title: string; detail: ReactNode; done: boolean; action?: ReactNode }[] }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
      {steps.map((step, i) => {
        const state = step.done ? "done" : i === current ? "current" : "upcoming";
        return (
          <li key={step.title} className="flex items-start gap-4 px-5 py-4" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={`mono mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[12px] font-semibold ${
                state === "done"
                  ? "border-success bg-success text-surface"
                  : state === "current"
                    ? "border-accent bg-accent-weak text-accent"
                    : "border-line-strong text-faint"
              }`}
            >
              {state === "done" ? <Icon name="check" className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[14px] font-medium ${state === "upcoming" ? "text-muted" : "text-ink"}`}>{step.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{step.detail}</p>
            </div>
            {state === "current" && step.action && <div className="shrink-0">{step.action}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Secondary navigation inside a workspace, such as Node, Capacity, and Stake. */
export function SubNav({ items, current }: { items: { href: string; label: string }[]; current: string }) {
  return (
    <nav aria-label="Workspace sections" className="mb-8 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.href === current ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 pb-2.5 text-[14px] font-medium transition-colors duration-fast ease-out ${
            item.href === current ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
