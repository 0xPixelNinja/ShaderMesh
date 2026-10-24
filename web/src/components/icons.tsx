import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "dashboard"
  | "gpu"
  | "model"
  | "jobs"
  | "providers"
  | "explorer"
  | "console"
  | "earnings"
  | "search"
  | "chevron"
  | "check"
  | "bolt"
  | "arrow"
  | "copy"
  | "wallet"
  | "shield"
  | "clock"
  | "alert"
  | "plus"
  | "close"
  | "pulse"
  | "send"
  | "inbox"
  | "sun"
  | "moon";

const PATHS: Record<IconName, ReactElement> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  gpu: (
    <>
      <rect x="4" y="7" width="16" height="10" rx="2" />
      <path d="M8 7V5M16 7V5M9 21h6" />
    </>
  ),
  model: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />,
  jobs: <path d="M4 6h16M4 12h16M4 18h10" />,
  providers: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  explorer: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </>
  ),
  console: <path d="M12 3v18M3 12h18" />,
  earnings: <path d="M3 17l6-6 4 4 8-8" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  bolt: <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h10" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <path d="M16 12h5M19 12h.01" />
    </>
  ),
  shield: <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />,
  pulse: <path d="M3 12h4l2-6 4 12 2-6h6" />,
  send: <path d="M4 12l16-8-6 16-2-6-8-2z" />,
  inbox: (
    <>
      <path d="M3 13h5l1 3h6l1-3h5" />
      <path d="M5 5h14l2 8v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z" />
    </>
  ),
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      {PATHS[name]}
    </svg>
  );
}

export function Logo() {
  return (
    <div className="grid h-[26px] w-[26px] grid-cols-3 grid-rows-3 gap-[2px] rounded-md border border-line-strong bg-bg p-1">
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={`rounded-[1px] ${[0, 4, 8].includes(i) ? "bg-accent" : "bg-faint"}`} />
      ))}
    </div>
  );
}
