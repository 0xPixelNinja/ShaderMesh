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
  | "arrow";

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
