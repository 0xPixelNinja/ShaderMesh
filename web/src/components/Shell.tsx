"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, Logo, type IconName } from "./icons";
import { useWallet } from "./WalletProvider";
import { Button } from "./ui";
import { ThemeToggle } from "./ThemeToggle";
import { fmtAmount, shortAddr } from "@/lib/format";
import { CHAIN_ID } from "@/lib/config";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

interface NavGroup {
  group: string | null;
  items: NavItem[];
}

/** Navigation follows what the visitor is doing: renting, providing, or inspecting. */
export const NAV: NavGroup[] = [
  { group: null, items: [{ href: "/dashboard", label: "Home", icon: "dashboard" }] },
  {
    group: "Rent",
    items: [
      { href: "/rent", label: "Marketplace", icon: "gpu" },
      { href: "/leases", label: "My leases", icon: "clock" },
      { href: "/models", label: "Inference", icon: "model" },
    ],
  },
  {
    group: "Provide",
    items: [
      { href: "/provide", label: "Node", icon: "pulse" },
      { href: "/provide/capacity", label: "Capacity", icon: "providers" },
      { href: "/provide/stake", label: "Stake", icon: "shield" },
    ],
  },
  { group: "Network", items: [{ href: "/explorer", label: "Explorer", icon: "explorer" }] },
];

const ALL_ITEMS = NAV.flatMap((group) => group.items);
const NETWORK_NAME = CHAIN_ID === 11155111 ? "Sepolia" : "Local devnet";

function NavLink({ href, label, icon, active }: NavItem & { active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex h-9 items-center gap-2.5 rounded-md border px-2.5 text-[14px] font-medium transition-colors duration-fast ease-out ${
        active ? "border-line bg-surface text-ink" : "border-transparent text-muted hover:bg-hover hover:text-ink"
      }`}
    >
      <Icon
        name={icon}
        className={`h-[17px] w-[17px] shrink-0 ${active ? "text-accent" : "text-faint group-hover:text-muted"}`}
        aria-hidden
      />
      {label}
    </Link>
  );
}

function WalletControl() {
  const { address, balanceWei, connect, connecting, disconnect } = useWallet();
  if (!address) {
    return (
      <Button variant="primary" onClick={connect} loading={connecting} icon="wallet">
        {connecting ? "Connecting" : "Connect wallet"}
      </Button>
    );
  }
  return (
    <span className="inline-flex h-9 items-center rounded-md border border-line bg-surface">
      <span className="mono hidden items-center gap-1.5 border-r border-line px-3 text-[13px] sm:inline-flex">
        <span className="font-semibold text-ink">{fmtAmount(balanceWei)}</span>
        <span className="text-faint">SMESH</span>
      </span>
      <span className="mono inline-flex items-center gap-1.5 px-3 text-[13px] text-ink2">
        <Icon name="wallet" className="h-3.5 w-3.5 text-faint" aria-hidden />
        {shortAddr(address)}
      </span>
      <button
        type="button"
        onClick={disconnect}
        aria-label="Disconnect wallet"
        title="Disconnect wallet"
        className="grid h-full w-8 place-items-center rounded-r-md border-l border-line text-faint transition-colors duration-fast ease-out hover:bg-hover hover:text-danger"
      >
        <Icon name="close" className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/provide") return pathname === "/provide";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // The landing page draws its own editorial frame.
  if (pathname === "/") return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col md:grid md:h-screen md:grid-cols-[232px_1fr]">
      <aside className="hidden min-h-0 flex-col border-r border-line bg-chrome px-3 pb-4 pt-3 md:flex">
        <Link href="/" className="mb-6 flex h-10 items-center gap-2.5 px-2.5" aria-label="ShaderMesh home">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight text-ink">ShaderMesh</span>
        </Link>

        <nav className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto" aria-label="Primary">
          {NAV.map((group) => (
            <div key={group.group ?? "home"}>
              {group.group && <h2 className="mb-1.5 px-2.5 text-[12px] font-medium text-faint">{group.group}</h2>}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-4 flex items-center gap-2 px-2.5 text-[13px] text-muted">
          <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
          {NETWORK_NAME}
          <span className="mono ml-auto text-[12px] text-faint">chain {CHAIN_ID}</span>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg px-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2 md:hidden" aria-label="ShaderMesh home">
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <WalletControl />
          </div>
        </header>

        <nav aria-label="Mobile navigation" className="flex gap-1 overflow-x-auto border-b border-line bg-chrome px-3 py-2 md:hidden">
          {ALL_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-fast ease-out ${
                  active ? "bg-surface text-ink" : "text-muted hover:bg-hover hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-bg px-4 pb-16 pt-8 sm:px-8">
          <div className="mx-auto w-full max-w-[1200px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
