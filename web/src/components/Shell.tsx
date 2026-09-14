"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, Logo } from "./icons";
import { useWallet } from "./WalletProvider";
import { fmtUsd, shortAddr } from "@/lib/format";

const NAV: { group: string; items: { href: string; label: string; icon: any; disabled?: boolean }[] }[] = [
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
      { href: "/providers", label: "Providers", icon: "providers", disabled: true },
      { href: "/explorer", label: "Explorer", icon: "explorer", disabled: true },
    ],
  },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  "/": { title: "Overview", sub: "Your rentals and network health" },
  "/rent": { title: "Rent GPUs", sub: "Lease compute from staked providers" },
  "/leases": { title: "My leases", sub: "Active and past rentals" },
  "/models": { title: "Models", sub: "Call open models served by providers" },
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { address, balanceWei, connect, connecting } = useWallet();
  const head = TITLES[pathname] ?? { title: "ShaderMesh", sub: "" };

  return (
    <div className="grid h-screen grid-cols-[240px_1fr]">
      <aside className="flex flex-col border-r border-line bg-surface p-3">
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

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-4 border-b border-line px-6 py-3.5">
          <div>
            <h1 className="text-base font-semibold tracking-tight">{head.title}</h1>
            <p className="mt-0.5 text-xs text-muted">{head.sub}</p>
          </div>
          <div className="flex-1" />
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs text-ink2">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Local devnet
          </span>
          <span className="mono rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink2">
            <b className="font-medium text-accent">{fmtUsd(balanceWei)}</b>
            <span className="ml-1 text-faint">SMESH</span>
          </span>
          {address ? (
            <span className="mono rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink2">{shortAddr(address)}</span>
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
            className="rounded-md border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink2 hover:bg-hover hover:text-ink"
          >
            Rent a GPU
          </Link>
        </header>
        <main className="overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
