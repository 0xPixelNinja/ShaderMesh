"use client";

import { useEffect, useState } from "react";
import { setProviderActive } from "@/lib/actions";
import { fmtSmesh, repScore, shortAddr } from "@/lib/format";
import { ChallengeTrack, EscrowIntervals, HeartbeatStrip } from "@/components/diagrams";
import {
  Button,
  Checklist,
  CopyValue,
  Empty,
  Facts,
  GpuChip,
  Meter,
  PageHeader,
  RepBar,
  Section,
  Skeleton,
  StatusTag,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import type { Challenge, Lease, Provider } from "@/lib/types";
import { ApiWarning, ConnectPrompt, LinkButton, ProvideNav, TxNotice } from "./parts";
import { asBigInt, useProvider, useTransactions, type ProviderData } from "./useProvider";

/** Seconds since the epoch, refreshed every few seconds for elapsed-interval math. */
function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function ago(ts: number | null | undefined, now: number): string {
  if (!ts || !now) return "-";
  const s = Math.max(now - ts, 0);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const OUTCOME: Record<Challenge["status"], string> = {
  open: "Open, awaiting answer",
  responded: "Answered, being judged",
  passed: "Passed",
  failed: "Failed, slashed",
  lapsed: "Lapsed",
};

export default function NodePage() {
  const data = useProvider();
  const tx = useTransactions();
  const { address, wallet, provider } = data;
  const ready = data.registered && data.staked && data.attested && data.published;

  return (
    <div>
      <PageHeader
        eyebrow="Provide"
        title="Node"
        description="Health, stake, and the work your node is serving right now."
      />
      <ProvideNav current="/provide" />
      <TxNotice notice={tx.notice} />
      <ApiWarning error={data.apiError} />

      <div className="space-y-12">
        {!address ? (
          <ConnectPrompt
            connect={wallet.connect}
            connecting={wallet.connecting}
            what="The wallet you connect owns the node's registration, stake, listings, and offers."
          />
        ) : data.loading && !data.states.providersState.data ? (
          <Skeleton label="Loading your node" rows={3} />
        ) : (
          <>
            {!ready && <Setup data={data} />}
            {provider?.registered && (
              <>
              <HealthBand
                provider={provider}
                pending={tx.pending}
                onToggle={() => {
                  const registry = data.deployment?.ProviderRegistry;
                  if (!registry) return;
                  void tx.run("active", [
                    {
                      prompt: `Confirm provider ${provider.active ? "deactivation" : "activation"} in your wallet.`,
                      write: () => setProviderActive(address, registry, !provider.active),
                    },
                  ]);
                }}
                canToggle={Boolean(data.deployment?.ProviderRegistry)}
              />
              <StakeAndEarnings data={data} />
              <Challenges data={data} />
              <Leases data={data} />
              </>
            )}
          </>
        )}

        <Registry providers={data.providers} loading={data.loading} error={data.states.providersState.error} self={address} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- setup */

function Setup({ data }: { data: ProviderData }) {
  const min = fmtSmesh(data.minStake.value, 0);
  const revoked = (data.provider?.challengesFailed ?? 0) > 0 && !data.attested;
  return (
    <Section
      title="Set up your node"
      description="Finish these steps to start earning. Each one is recorded on chain."
    >
      <Checklist
        steps={[
          {
            title: "Connect wallet",
            detail: <>Connected as <span className="mono text-ink2">{shortAddr(data.address)}</span>.</>,
            done: true,
          },
          {
            title: "Register hardware profile",
            detail: "Describe your GPU, VRAM, CPU, and models in a short JSON profile.",
            done: data.registered,
            action: <LinkButton primary href="/provide/capacity#hardware">Register</LinkButton>,
          },
          {
            title: `Stake at least ${min}`,
            detail: (
              <>
                Stake is collateral that backs your service. You have{" "}
                <span className="mono text-ink2">{fmtSmesh(data.stake)}</span> staked.
              </>
            ),
            done: data.staked,
            action: <LinkButton primary href="/provide/stake">Add stake</LinkButton>,
          },
          {
            title: "Attestation by the operator",
            detail: revoked
              ? "Your attestation was revoked after a failed benchmark challenge. Keep the agent running; the attester re-checks the hardware and records a fresh attestation."
              : "The network's attester benchmarks your GPU and records the result on chain. You do not submit anything here: keep the provider agent running and this step completes on its own.",
            done: data.attested,
          },
          {
            title: "Publish capacity",
            detail: "Create a rental listing or an inference offer so requesters can find you.",
            done: data.published,
            action: <LinkButton primary href="/provide/capacity">Publish</LinkButton>,
          },
        ]}
      />
    </Section>
  );
}

/* ---------------------------------------------------------------- health */

function HealthBand({
  provider,
  pending,
  onToggle,
  canToggle,
}: {
  provider: Provider;
  pending: string | null;
  onToggle: () => void;
  canToggle: boolean;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-line pb-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3.5">
        <GpuChip live={provider.active} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink" title={provider.gpu}>
            {provider.gpu || "Hardware not yet attested"}
          </p>
          {provider.attested ? (
            <p className="mt-0.5 text-[13px] text-muted">
              <span className="mono text-ink2">{provider.vramGB} GB</span> VRAM, attested, benchmark score{" "}
              <span className="mono text-ink2">{provider.benchmarkScore}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-[13px] text-warning">Not attested. Listings and offers stay closed until the attester checks this node.</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <p className="mb-1 text-[12px] text-faint">Status</p>
          <StatusTag status={provider.active ? "Active" : "Inactive"} />
        </div>
        <div>
          <p className="mb-1 text-[12px] text-faint">Reputation</p>
          <RepBar score={repScore(provider.reputation)} />
        </div>
        <Button
          variant={provider.active ? "secondary" : "primary"}
          onClick={onToggle}
          disabled={!canToggle || (pending !== null && pending !== "active")}
          loading={pending === "active"}
        >
          {provider.active ? "Set inactive" : "Set active"}
        </Button>
      </div>
    </div>
  );
}

function StakeAndEarnings({ data }: { data: ProviderData }) {
  const { provider } = data;
  return (
    <Section title="Stake and earnings" description="Bonded stake backs active leases. Earnings are indexed from settled intervals and paid usage.">
      <div className="max-sm:[&_dl]:grid-cols-2">
      <Facts
        columns={3}
        items={[
          { label: "Total stake", value: fmtSmesh(data.stake) },
          { label: "Bonded to leases", value: fmtSmesh(data.bonded), tone: data.bonded > 0n ? "accent" : "default" },
          { label: "Free stake", value: fmtSmesh(data.free) },
          { label: "Reputation", value: `${repScore(provider?.reputation ?? 5000)} / 100`, sub: `${provider?.completed ?? 0} completed, ${provider?.failed ?? 0} failed` },
          { label: "Rental earnings", value: fmtSmesh(data.rentalEarnings), tone: data.rentalEarnings > 0n ? "success" : "default" },
          { label: "Inference earnings", value: fmtSmesh(data.inferenceEarnings), tone: data.inferenceEarnings > 0n ? "success" : "default" },
        ]}
      />
      </div>
      <div className="mt-8">
        <Meter
          label={`Stake split: ${fmtSmesh(data.bonded)} bonded, ${fmtSmesh(data.free)} free`}
          parts={[
            { value: Number(data.bonded / 10n ** 15n), label: `Bonded ${fmtSmesh(data.bonded)}`, tone: "accent" },
            { value: Number(data.free / 10n ** 15n), label: `Free ${fmtSmesh(data.free)}`, tone: "muted" },
          ]}
        />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ challenges */

function Challenges({ data }: { data: ProviderData }) {
  const now = useNow();
  const { provider, challenges } = data;
  const state = data.states.challengesState;
  const last = [...challenges].sort((a, b) => b.id - a.id)[0];
  const answered = last?.responded?.timestamp && last.issuedAt ? last.responded.timestamp - last.issuedAt : null;
  return (
    <Section
      title="Benchmark challenges"
      description={`${provider?.challengesPassed ?? 0} passed, ${provider?.challengesFailed ?? 0} failed. The attester re-runs a random benchmark to confirm the hardware you declared.`}
    >
      {state.loading && !state.data ? (
        <Skeleton label="Loading challenges" rows={1} />
      ) : (
        <div className="space-y-8">
          <ChallengeTrack challenges={challenges} />
          {last && (
            <div>
              <h3 className="mb-4 text-[13px] font-medium text-ink2">Last challenge, #{last.id}</h3>
              <div className="max-sm:[&_dl]:grid-cols-2">
              <Facts
                items={[
                  {
                    label: "Outcome",
                    value: <span className="font-sans">{OUTCOME[last.status]}</span>,
                    tone: last.status === "passed" ? "success" : last.status === "failed" ? "danger" : last.status === "lapsed" ? "default" : "accent",
                    sub: asBigInt(last.slashed) > 0n ? `${fmtSmesh(last.slashed)} slashed` : undefined,
                  },
                  { label: "Score", value: last.score ?? "-" },
                  { label: "Answered in", value: answered !== null ? `${answered}s` : "-" },
                  { label: "Issued", value: ago(last.issuedAt, now) },
                ]}
              />
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- leases */

function Leases({ data }: { data: ProviderData }) {
  const now = useNow();
  const state = data.states.leasesState;
  const current = data.leases.filter((l) => l.status === "Active" || l.status === "Pending");
  const past = data.leases.filter((l) => l.status !== "Active" && l.status !== "Pending");
  const activeCount = current.filter((l) => l.status === "Active").length;
  return (
    <Section
      title="Leases you are serving"
      description="Your agent accepts requests, bonds stake, and signs a heartbeat each interval."
      action={<span className="text-[13px] text-faint">{activeCount} active</span>}
    >
      {state.loading && !state.data ? (
        <Skeleton label="Loading lease activity" rows={2} />
      ) : current.length === 0 ? (
        <Empty
          icon="inbox"
          title="No leases right now"
          hint="When a requester leases your capacity, the agent accepts it automatically and it appears here within a few seconds. Keep a listing active on the Capacity page."
        />
      ) : (
        <ul className="space-y-3">
          {current.map((lease) => (
            <LeaseRow key={lease.id} lease={lease} now={now} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className="group mt-6">
          <summary className="cursor-pointer select-none text-[13px] font-medium text-muted hover:text-ink">
            Past leases ({past.length})
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <Th>Lease</Th>
                  <Th>Requester</Th>
                  <Th>Status</Th>
                  <Th align="right">Settled / funded</Th>
                  <Th align="right">Earned</Th>
                </tr>
              </thead>
              <tbody>
                {past.map((lease) => (
                  <Tr key={lease.id}>
                    <Td className="mono">#{lease.id}</Td>
                    <Td><CopyValue value={lease.requester} label="requester address" /></Td>
                    <Td><StatusTag status={lease.status} /></Td>
                    <Td align="right" className="mono">{lease.settledIntervals} / {lease.fundedIntervals}</Td>
                    <Td align="right" className="mono">{fmtSmesh(asBigInt(lease.pricePerInterval) * BigInt(lease.settledIntervals))}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Section>
  );
}

function LeaseRow({ lease, now }: { lease: Lease; now: number }) {
  const earned = asBigInt(lease.pricePerInterval) * BigInt(lease.settledIntervals);
  const isActive = lease.status === "Active";
  const elapsed =
    isActive && now && lease.start && lease.intervalSecs
      ? Math.min(lease.fundedIntervals, Math.max(Math.floor((now - lease.start) / lease.intervalSecs), lease.heartbeatedIntervals))
      : lease.heartbeatedIntervals;
  return (
    <li className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="mono text-[15px] font-semibold text-ink">Lease #{lease.id}</span>
            <StatusTag status={lease.status} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            Requester <CopyValue value={lease.requester} label="requester address" />
            <span className="text-faint">listing #{lease.listingId}</span>
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-[12px] text-faint">Earned so far</p>
          <p className="mono mt-0.5 text-[18px] font-semibold text-ink">{fmtSmesh(earned)}</p>
          <p className="mono mt-0.5 text-[12px] text-faint">{fmtSmesh(lease.bond)} bonded</p>
        </div>
      </div>
      {lease.status === "Pending" ? (
        <p className="mt-4 text-[13px] text-muted">Awaiting your agent to accept and bond stake.</p>
      ) : (
        <div className="mt-5 grid gap-6 border-t border-line pt-5 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] font-medium text-muted">Heartbeats</p>
            <HeartbeatStrip elapsed={elapsed} beats={lease.heartbeatedIntervals} live={isActive} />
          </div>
          <div>
            <p className="mb-2 text-[12px] font-medium text-muted">Escrow intervals</p>
            <EscrowIntervals
              funded={lease.fundedIntervals}
              heartbeated={lease.heartbeatedIntervals}
              settled={lease.settledIntervals}
              max={lease.maxIntervals}
              current={isActive ? elapsed : null}
            />
          </div>
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------- registry */

function Registry({
  providers,
  loading,
  error,
  self,
}: {
  providers: Provider[];
  loading: boolean;
  error: string | null;
  self: string | null;
}) {
  return (
    <Section title="Provider registry" description={`${providers.length} ${providers.length === 1 ? "provider" : "providers"} indexed on this network.`}>
      {loading && providers.length === 0 ? (
        <Skeleton label="Loading providers" rows={2} />
      ) : error && providers.length === 0 ? (
        <Empty title="The provider registry could not be loaded" hint="Check the orchestrator connection." />
      ) : providers.length === 0 ? (
        <Empty title="No registered providers" hint="Connect a wallet and register the first provider." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <Th>Provider</Th>
                <Th>Status</Th>
                <Th>Hardware</Th>
                <Th align="right">Stake</Th>
                <Th>Reputation</Th>
                <Th align="right">Outcomes</Th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <Tr key={p.address}>
                  <Td>
                    <CopyValue value={p.address} label="provider address" />
                    {self && p.address.toLowerCase() === self.toLowerCase() && (
                      <span className="ml-1 text-[12px] text-accent">you</span>
                    )}
                  </Td>
                  <Td><StatusTag status={p.active ? "Active" : "Inactive"} /></Td>
                  <Td>
                    <span className="block min-w-[200px] text-ink2">{p.gpu || "Not declared"}{p.vramGB ? `, ${p.vramGB} GB` : ""}</span>
                    <span className={`text-[12px] ${p.attested ? "text-success" : "text-faint"}`}>
                      {p.attested ? `Attested, score ${p.benchmarkScore}` : "Not attested"}
                    </span>
                  </Td>
                  <Td align="right" className="mono">
                    <span className="block">{fmtSmesh(p.stake)}</span>
                    <span className="text-[12px] text-faint">{fmtSmesh(p.availableStake)} free</span>
                  </Td>
                  <Td><RepBar score={repScore(p.reputation)} /></Td>
                  <Td align="right" className="mono text-muted">{p.completed} passed, {p.failed} failed</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
