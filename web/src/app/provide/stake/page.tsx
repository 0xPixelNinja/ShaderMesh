"use client";

import { useState } from "react";
import { approveProviderStake, claimFaucet, stakeProvider, unstakeProvider } from "@/lib/actions";
import { fmtSmesh } from "@/lib/format";
import { Button, Facts, Field, Input, Meter, Note, PageHeader, Section } from "@/components/ui";
import { ApiWarning, ConnectPrompt, FormFooter, LinkButton, ProvideNav, TxNotice } from "../parts";
import { parseAmount, useProvider, useTransactions } from "../useProvider";

export default function StakePage() {
  const data = useProvider();
  const tx = useTransactions();
  const { address, wallet, deployment, provider } = data;
  const [stakeAmount, setStakeAmount] = useState("100");
  const [unstakeAmount, setUnstakeAmount] = useState("0");
  const registry = deployment?.ProviderRegistry;
  const token = deployment?.SmeshToken;
  const min = fmtSmesh(data.minStake.value, 0);

  const stakeReason = !data.registered
    ? "Register a hardware profile before staking."
    : !registry || !token
      ? "Contract addresses not loaded yet."
      : null;
  const unstakeReason = !data.registered
    ? "Nothing is staked yet."
    : data.challengeOpen
      ? "A benchmark challenge is open. Unstaking unlocks once it resolves."
      : data.free === 0n
        ? "No free stake to withdraw. Bonded stake unlocks when its leases end."
        : !registry
          ? "Provider registry address not loaded yet."
          : null;

  async function addStake() {
    if (!address || !registry || !token) return;
    try {
      const value = parseAmount(stakeAmount, "stake");
      if (value > wallet.balanceWei) throw new Error("Stake amount exceeds the connected wallet balance.");
      await tx.run(
        "stake",
        [
          { prompt: "Approve the Provider Registry to transfer this SMESH.", write: () => approveProviderStake(address, token, registry, value) },
          { prompt: "Approval confirmed. Confirm the stake transaction.", write: () => stakeProvider(address, registry, value) },
        ],
        "Stake confirmed. Indexed balances will refresh shortly.",
      );
    } catch (error) {
      tx.fail(error);
    }
  }

  async function removeStake() {
    if (!address || !registry || !provider) return;
    try {
      const value = parseAmount(unstakeAmount, "unstake");
      if (value > data.free) throw new Error("Unstake amount exceeds free stake. Bonded stake cannot be withdrawn.");
      await tx.run("unstake", [
        { prompt: "Confirm the free-stake withdrawal in your wallet.", write: () => unstakeProvider(address, registry, value) },
      ]);
    } catch (error) {
      tx.fail(error);
    }
  }

  function faucet() {
    if (!address || !token) return;
    void tx.run("faucet", [{ prompt: "Confirm the testnet faucet claim in your wallet.", write: () => claimFaucet(address, token) }]);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Provide"
        title="Stake"
        description="Collateral that backs your node. Add stake to qualify, withdraw what is not in use."
      />
      <ProvideNav current="/provide/stake" />
      <TxNotice notice={tx.notice} />
      <ApiWarning error={data.apiError} />

      {!address ? (
        <ConnectPrompt
          connect={wallet.connect}
          connecting={wallet.connecting}
          what="Connect the provider wallet to see and manage its stake."
        />
      ) : (
        <div className="space-y-12">
          <Section
            title="Registration"
            action={!data.registered ? <LinkButton primary href="/provide/capacity#hardware">Register</LinkButton> : undefined}
          >
            <Facts
              columns={4}
              items={[
                {
                  label: "Provider",
                  value: <span className="font-sans">{data.registered ? (data.active ? "Registered, active" : "Registered, inactive") : "Not registered"}</span>,
                  tone: data.registered && data.active ? "success" : "default",
                },
                { label: "Minimum stake", value: min, sub: data.minStake.known ? "Read from the registry" : "Deployment default" },
                {
                  label: "Total stake",
                  value: fmtSmesh(data.stake),
                  tone: data.staked ? "default" : "accent",
                  sub: data.registered ? (data.staked ? "Meets the minimum" : `Below the ${min} minimum`) : undefined,
                },
                { label: "Wallet balance", value: fmtSmesh(wallet.balanceWei) },
              ]}
            />
          </Section>

          <Section title="Manage stake" description="Staking takes two wallet confirmations: an approval, then the stake itself.">
            <Meter
              label={`Stake split: ${fmtSmesh(data.bonded)} bonded, ${fmtSmesh(data.free)} free`}
              parts={[
                { value: Number(data.bonded / 10n ** 15n), label: `Bonded ${fmtSmesh(data.bonded)}`, tone: "accent" },
                { value: Number(data.free / 10n ** 15n), label: `Free ${fmtSmesh(data.free)}`, tone: "muted" },
              ]}
            />
            {data.challengeOpen && (
              <div className="mt-6">
                <Note tone="accent">
                  Benchmark challenge #{provider?.lastChallenge?.id} is {provider?.lastChallenge?.status === "open" ? "open" : "answered and being judged"}. Unstaking is blocked until it resolves.
                </Note>
              </div>
            )}
            <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
              <div className="space-y-4">
                <Field label="Add stake (SMESH)" hint={`Wallet balance ${fmtSmesh(wallet.balanceWei)}`}>
                  <Input value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} inputMode="decimal" className="mono" disabled={Boolean(stakeReason)} />
                </Field>
                <FormFooter reason={stakeReason}>
                  <Button
                    variant="primary"
                    onClick={addStake}
                    disabled={Boolean(stakeReason) || (tx.pending !== null && tx.pending !== "stake")}
                    loading={tx.pending === "stake"}
                  >
                    Approve and stake
                  </Button>
                </FormFooter>
              </div>
              <div className="space-y-4">
                <Field label="Withdraw free stake (SMESH)" hint={`${fmtSmesh(data.free)} free to withdraw`}>
                  <Input value={unstakeAmount} onChange={(e) => setUnstakeAmount(e.target.value)} inputMode="decimal" className="mono" disabled={Boolean(unstakeReason)} />
                </Field>
                <FormFooter reason={unstakeReason}>
                  <Button
                    onClick={removeStake}
                    disabled={Boolean(unstakeReason) || (tx.pending !== null && tx.pending !== "unstake")}
                    loading={tx.pending === "unstake"}
                  >
                    Unstake
                  </Button>
                </FormFooter>
              </div>
            </div>
          </Section>

          <Section title="How stake is used">
            <dl className="grid gap-x-10 gap-y-6 text-[13px] leading-relaxed md:grid-cols-3">
              <div>
                <dt className="font-medium text-ink">Bonded stake</dt>
                <dd className="mt-1 text-muted">Locked to a lease while you serve it. A breach of the lease terms slashes this bond. It returns to free stake when the lease ends.</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">Free stake</dt>
                <dd className="mt-1 text-muted">Stake not tied to any lease. You can withdraw it at any time. Total stake must stay at or above {min} for the node to qualify.</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">Benchmark challenges</dt>
                <dd className="mt-1 text-muted">A failed challenge slashes free stake only, never a lease bond. Unstaking is blocked while a challenge is open.</dd>
              </div>
            </dl>
          </Section>

          {data.isTestNetwork && (
            <Section title="Test tokens" description="This is a test network. Claim SMESH from the faucet to stake and to rent.">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-[13px] text-muted">
                  Balance <span className="mono text-ink2">{fmtSmesh(wallet.balanceWei)}</span>
                </p>
                <Button
                  onClick={faucet}
                  disabled={!token || (tx.pending !== null && tx.pending !== "faucet")}
                  loading={tx.pending === "faucet"}
                >
                  Claim 1,000 SMESH
                </Button>
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
