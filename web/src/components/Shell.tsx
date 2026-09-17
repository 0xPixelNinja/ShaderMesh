"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, Logo, type IconName } from "./icons";
import { useWallet } from "./WalletProvider";
import { fmtUsd, shortAddr } from "@/lib/format";
import { CHAIN_ID } from "@/lib/config";

interface NavigationGroup {
  group: string;
  items: { href: string; label: string; icon: IconName; disabled?: boolean }[];
}

const NAV: NavigationGroup[] = [
  {
    group: "Compute",
    items: [
      { href: "/", label: "Overview", icon: "dashboard" },
      { href: "/rent", label: "Rent GPUs", icon: "gpu" },
      { href: "/leases", label: "My leases", icon: "jobs" },
    ],
  },
  { group: "AI", items: [{ href: "/models", label: "Models", icon: "model" }] },
  {
    group: "Network",
    items: [
      { href: "/providers", label: "Providers", icon: "providers" },
      { href: "/explorer", label: "Explorer", icon: "explorer" },
    ],
  },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  "/": { title: "Overview", sub: "Your rentals and network health" },
  "/rent": { title: "Rent GPUs", sub: "Request compute from staked providers" },
  "/leases": { title: "My leases", sub: "Pending, active, and past rental requests" },
  "/models": { title: "Models", sub: "Call open models served by providers" },
  "/providers": { title: "Provider console", sub: "Manage collateral, capacity, and inference offers" },
  "/explorer": { title: "Explorer", sub: "Inspect indexed protocol state and on-chain activity" },
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { address, balanceWei, connect, connecting } = useWallet();
  const head = TITLES[pathname] ?? { title: "ShaderMesh", sub: "" };

  return (
    <div className="flex min-h-screen flex-col md:grid md:h-screen md:grid-cols-[240px_1fr]">
      <aside className="hidden flex-col border-r border-line bg-surface p-3 md:flex">
        <div className="flex items-center gap-2.5 px-2 pb-4 pt-1.5">
          <Logo />
          <b className="text-[15px] font-semibold tracking-tight">ShaderMesh</b>
        </div>
        {NAV.map((g) => (
          <div key={g.group}>
            <h5 className="mb-1.5 mt-3 px-2 text-[11px] font-medium uppercase tracking-wider text-faint">{g.group}</h5>
            <nav className="flex flex-col gap-0.5">
              {g.items.map((it) => {
                const active = pathname === it.href;
                const cls =
                  "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium " +
                  (it.disabled
                    ? "cursor-not-allowed text-faint"
                    : active
                      ? "bg-hover text-ink"
                      : "text-ink2 hover:bg-hover hover:text-ink");
                const inner = (
                  <>
                    {active && <span className="absolute -left-3 bottom-2 top-2 w-0.5 rounded-full bg-accent" />}
                    <Icon name={it.icon} className={`h-4 w-4 ${active ? "text-accent" : "text-muted"}`} />
                    {it.label}
                  </>
                );
                return it.disabled ? (
                  <span key={it.href} className={cls} title="Coming soon">{inner}</span>
                ) : (
                  <Link key={it.href} href={it.href} className={cls}>{inner}</Link>
                );
              })}
            </nav>
          </div>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 rounded-md border border-line bg-panel p-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${address ? "bg-success" : "bg-faint"}`} />
          <div className="min-w-0">
            <small className="block text-xs text-muted">{address ? "Wallet connected" : "Not connected"}</small>
            <span className="mono text-xs">{address ? shortAddr(address) : "-"}</span>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-3.5 sm:gap-4 sm:px-6">
          <Link href="/" className="grid shrink-0 md:hidden" aria-label="ShaderMesh overview"><Logo /></Link>
          <div className="min-w-0 [flex:1_0_calc(100%-2.5rem)] sm:flex-1">
            <h1 className="text-base font-semibold tracking-tight">{head.title}</h1>
            <p className="mt-0.5 text-xs text-muted">{head.sub}</p>
          </div>
          <span className="hidden items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs text-ink2 lg:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {CHAIN_ID === 11155111 ? "Sepolia" : "Local devnet"}
          </span>
          <span className="mono rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink2">
            <b className="font-medium text-accent">{fmtUsd(balanceWei)}</b>
            <span className="ml-1 text-faint">SMESH</span>
          </span>
          {address ? (
            <span className="mono hidden rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink2 sm:inline">{shortAddr(address)}</span>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="rounded-md border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1A1205] hover:bg-accent-hover disabled:opacity-60"
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
          <Link
            href="/rent"
            className="hidden rounded-md border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink2 hover:bg-hover hover:text-ink sm:inline-flex"
          >
            Rent a GPU
          </Link>
        </header>
        <nav aria-label="Mobile navigation" className="grid grid-cols-3 gap-1 border-b border-line bg-surface px-3 py-2 md:hidden">
          {NAV.flatMap((group) => group.items).filter((item) => !item.disabled).map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-2 py-2 text-center text-xs font-medium ${active ? "bg-hover text-accent" : "text-ink2 hover:bg-hover hover:text-ink"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
