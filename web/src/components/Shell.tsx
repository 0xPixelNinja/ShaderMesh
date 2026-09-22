"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, Logo, type IconName } from "./icons";
import { useWallet } from "./WalletProvider";
import { Button } from "./ui";
import { fmtUsd, shortAddr } from "@/lib/format";
import { CHAIN_ID } from "@/lib/config";

interface NavigationGroup {
  group: string;
  items: { href: string; label: string; icon: IconName }[];
}

const NAV: NavigationGroup[] = [
  {
    group: "Compute",
    items: [
      { href: "/", label: "Overview", icon: "dashboard" },
      { href: "/rent", label: "Rent GPUs", icon: "gpu" },
      { href: "/leases", label: "My leases", icon: "clock" },
    ],
  },
  { group: "AI", items: [{ href: "/models", label: "Models", icon: "model" }] },
  {
    group: "Network",
    items: [
      { href: "/providers", label: "Provider console", icon: "providers" },
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

const ALL_ITEMS = NAV.flatMap((group) => group.items);

function NavLink({ href, label, icon, active }: { href: string; label: string; icon: IconName; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] font-medium transition-colors duration-fast ease-out ${
        active ? "bg-hover text-ink" : "text-muted hover:bg-hover/60 hover:text-ink"
      }`}
    >
      {active && <span className="absolute -left-3 bottom-1.5 top-1.5 w-[3px] rounded-r-full bg-accent" />}
      <Icon
        name={icon}
        className={`h-[18px] w-[18px] shrink-0 ${active ? "text-accent" : "text-faint group-hover:text-muted"}`}
        aria-hidden
      />
      {label}
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { address, balanceWei, connect, connecting } = useWallet();
  const head = TITLES[pathname] ?? { title: "ShaderMesh", sub: "" };

  return (
    <div className="flex min-h-screen flex-col md:grid md:h-screen md:grid-cols-[248px_1fr]">
      <aside className="hidden min-h-0 flex-col border-r border-line bg-chrome px-3 py-4 md:flex">
        <Link href="/" className="mb-5 flex items-center gap-2.5 px-2" aria-label="ShaderMesh overview">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight text-ink">ShaderMesh</span>
        </Link>

        <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto" aria-label="Primary">
          {NAV.map((group) => (
            <div key={group.group}>
              <h2 className="mb-1.5 px-2.5 text-[12px] font-medium uppercase tracking-wider text-faint">
                {group.group}
              </h2>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} {...item} active={pathname === item.href} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-4 shrink-0 rounded-lg border border-line bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${address ? "bg-success" : "bg-faint"}`}
              aria-hidden
            />
            <span className="text-[13px] text-muted">{address ? "Wallet connected" : "Not connected"}</span>
          </div>
          <div className="mono mt-1 truncate text-[13px] text-ink2">
            {address ? shortAddr(address) : "No account"}
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-chrome px-4 py-3 sm:px-6">
          <Link href="/" className="grid shrink-0 md:hidden" aria-label="ShaderMesh overview">
            <Logo />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold leading-tight tracking-tight">{head.title}</h1>
            <p className="mt-0.5 truncate text-[13px] leading-tight text-muted">{head.sub}</p>
          </div>

          <span className="hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-muted lg:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            {CHAIN_ID === 11155111 ? "Sepolia" : "Local devnet"}
          </span>

          <span className="mono inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px]">
            <span className="font-semibold text-ink">{fmtUsd(balanceWei)}</span>
            <span className="text-faint">SMESH</span>
          </span>

          {address ? (
            <span className="mono hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink2 sm:inline-flex">
              <Icon name="wallet" className="h-3.5 w-3.5 text-faint" aria-hidden />
              {shortAddr(address)}
            </span>
          ) : (
            <Button variant="primary" onClick={connect} loading={connecting} icon="wallet">
              {connecting ? "Connecting" : "Connect wallet"}
            </Button>
          )}
        </header>

        <nav
          aria-label="Primary"
          className="flex gap-1 overflow-x-auto border-b border-line bg-chrome px-3 py-2 md:hidden"
        >
          {ALL_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-fast ease-out ${
                  active ? "bg-hover text-accent" : "text-muted hover:bg-hover hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
