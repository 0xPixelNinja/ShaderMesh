"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useApi, api } from "@/lib/api";
import { useWallet } from "@/components/WalletProvider";
import { Button, Card, CardHead, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import {
  approveInferenceCredit,
  closeInferenceCredit,
  openInferenceCredit,
  settleInferenceUsage,
  signInferenceAuthorization,
  waitForTransaction,
} from "@/lib/actions";
import {
  DEFAULT_INFERENCE_CREDIT_SMESH,
  INFERENCE_AUTH_TTL_SECONDS,
  ORCHESTRATOR_URL,
} from "@/lib/config";
import { fmtSmesh, shortAddr } from "@/lib/format";
import type { Deployment, InferenceCredit, InferenceOffer } from "@/lib/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface PendingSettlement {
  creditId: string;
  promptTokens: string;
  completionTokens: string;
  promptDelta: string;
  completionDelta: string;
  txHash?: `0x${string}`;
}

interface LocalCreditState {
  escrow: string;
  paid: string;
  promptTokens: string;
  completionTokens: string;
  active: boolean;
}

interface TransactionState {
  label: string;
  hash?: string;
  tone?: "success" | "error";
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
  error?: string;
}

function tokenCount(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function pricePerThousand(pricePerToken: string): string {
  const amount = BigInt(pricePerToken) * 1000n;
  const formatted = amount > 0n && amount < 1_000_000_000_000n
    ? "<0.000001 SMESH"
    : fmtSmesh(amount, amount < 10_000_000_000_000_000n ? 6 : 4);
  return `${formatted} / 1K tokens`;
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message.split("\n")[0];
}

function authorizationExpiry(): number {
  return Math.floor(Date.now() / 1000) + INFERENCE_AUTH_TTL_SECONDS;
}

function hasIndexedSettlement(
  settlement: PendingSettlement | null,
  indexedCredits: InferenceCredit[],
): settlement is PendingSettlement & { txHash: `0x${string}` } {
  if (!settlement?.txHash) return false;
  if (BigInt(settlement.promptDelta) + BigInt(settlement.completionDelta) === 0n) return false;
  const indexed = indexedCredits.find((credit) => credit.id === settlement.creditId);
  return Boolean(
    indexed
    && BigInt(indexed.promptTokens) >= BigInt(settlement.promptTokens)
    && BigInt(indexed.completionTokens) >= BigInt(settlement.completionTokens),
  );
}

function hasIndexedLocalState(indexed: InferenceCredit, local: LocalCreditState): boolean {
  const settled =
    BigInt(indexed.promptTokens) >= BigInt(local.promptTokens)
    && BigInt(indexed.completionTokens) >= BigInt(local.completionTokens)
    && BigInt(indexed.paid) >= BigInt(local.paid)
    && BigInt(indexed.escrow) <= BigInt(local.escrow);
  const closed = !local.active && !indexed.active;
  return settled || closed;
}

export default function ModelsPage() {
  const { address, balanceWei, connect } = useWallet();
  const offersState = useApi<InferenceOffer[]>("/offers", 5000);
  const creditsState = useApi<InferenceCredit[]>(
    address
      ? `/credits?requester=${encodeURIComponent(address)}`
      : "/credits?requester=0x0000000000000000000000000000000000000000",
    2000,
  );
  const deploymentState = useApi<Deployment>("/deployment", 30000);
  const indexedCredits = creditsState.data ?? [];
  const allOffers = offersState.data ?? [];

  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [selectedCreditId, setSelectedCreditId] = useState("");
  const [creditAmount, setCreditAmount] = useState(DEFAULT_INFERENCE_CREDIT_SMESH);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [operation, setOperation] = useState<"opening" | "requesting" | "settling" | "closing" | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<PendingSettlement | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [localCredits, setLocalCredits] = useState<Record<string, LocalCreditState>>({});
  const [transaction, setTransaction] = useState<TransactionState | null>(null);
  const [lastUsage, setLastUsage] = useState<{ prompt: bigint; completion: bigint; cost: bigint } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const activeOffers = allOffers.filter((offer) => offer.active);
  const offerById = new Map(allOffers.map((offer) => [offer.id, offer]));
  const selectedOffer = activeOffers.find((offer) => offer.id === selectedOfferId) ?? activeOffers[0] ?? null;
  const selectedModel = selectedOffer?.modelIdentifier ?? "";
  const credits = indexedCredits.map((credit) => {
    const local = localCredits[credit.id];
    return {
      ...credit,
      ...(local && !hasIndexedLocalState(credit, local) ? local : {}),
    };
  });
  const matchingCredits = credits.filter((credit) => {
    const offer = offerById.get(credit.offerId);
    return credit.active && BigInt(credit.escrow) > 0n && offer?.modelIdentifier === selectedModel;
  });
  const selectedCredit = matchingCredits.find((credit) => credit.id === selectedCreditId) ?? matchingCredits[0] ?? null;
  const settlementReconciled = hasIndexedSettlement(pendingSettlement, indexedCredits);
  const activePendingSettlement = settlementReconciled ? null : pendingSettlement;
  const activeBlockedReason = settlementReconciled ? null : blockedReason;
  const displayedTransaction = settlementReconciled
    ? { label: "Usage settlement reconciled from chain state", hash: pendingSettlement.txHash, tone: "success" as const }
    : transaction;
  const locked = operation !== null || activePendingSettlement !== null || activeBlockedReason !== null;

  function selectOffer(offer: InferenceOffer) {
    if (locked) return;
    if (offer.modelIdentifier !== selectedModel) {
      setMessages([]);
      setLastUsage(null);
      setSelectedCreditId("");
    }
    setSelectedOfferId(offer.id);
  }

  async function handleOpenCredit() {
    setErr(null);
    if (!address) {
      await connect();
      return;
    }
    if (!selectedOffer) {
      setErr("Select an active inference offer first.");
      return;
    }
    const deployment = deploymentState.data;
    if (!deployment?.contracts?.InferenceMarket || !deployment.contracts.SmeshToken) {
      setErr("InferenceMarket deployment is not available.");
      return;
    }

    let amount: bigint;
    try {
      amount = parseUnits(creditAmount.trim(), 18);
    } catch {
      setErr("Enter a valid SMESH credit amount.");
      return;
    }
    if (amount <= 0n) {
      setErr("Credit amount must be greater than zero.");
      return;
    }
    if (amount > balanceWei) {
      setErr("Credit amount exceeds the connected wallet balance.");
      return;
    }

    setOperation("opening");
    try {
      setTransaction({ label: "Approve SMESH in your wallet" });
      const approvalHash = await approveInferenceCredit(
        address,
        deployment.contracts.SmeshToken,
        deployment.contracts.InferenceMarket,
        amount,
      );
      setTransaction({ label: "Approval submitted, waiting for confirmation", hash: approvalHash });
      await waitForTransaction(approvalHash);

      setTransaction({ label: "Open the prepaid credit in your wallet" });
      const openHash = await openInferenceCredit(
        address,
        deployment.contracts.InferenceMarket,
        selectedOffer.id,
        amount,
      );
      setTransaction({ label: "Credit transaction submitted, waiting for confirmation", hash: openHash });
      await waitForTransaction(openHash);
      setTransaction({
        label: "Credit confirmed. It will appear after the indexer refreshes.",
        hash: openHash,
        tone: "success",
      });
    } catch (error) {
      const message = `Credit opening failed: ${errorText(error)}`;
      setErr(message);
      setTransaction({ label: message, tone: "error" });
    } finally {
      setOperation(null);
    }
  }

  async function submitSettlement(settlement: PendingSettlement, credit: InferenceCredit) {
    if (!address || !deploymentState.data?.contracts?.InferenceMarket) return;
    setOperation("settling");
    setErr(null);
    let submittedHash = settlement.txHash;
    try {
      setTransaction({ label: `Confirm usage settlement for credit #${credit.id}` });
      const hash = await settleInferenceUsage(
        address,
        deploymentState.data.contracts.InferenceMarket,
        credit.id,
        BigInt(settlement.promptTokens),
        BigInt(settlement.completionTokens),
      );
      submittedHash = hash;
      setPendingSettlement((current) => current?.creditId === credit.id ? { ...current, txHash: hash } : current);
      setTransaction({ label: "Usage settlement submitted, waiting for confirmation", hash });
      await waitForTransaction(hash);

      const billedTokens = BigInt(settlement.promptDelta) + BigInt(settlement.completionDelta);
      const payment = billedTokens * BigInt(credit.pricePerToken);
      setLocalCredits((current) => ({
        ...current,
        [credit.id]: {
          promptTokens: settlement.promptTokens,
          completionTokens: settlement.completionTokens,
          paid: (BigInt(credit.paid) + payment).toString(),
          escrow: (BigInt(credit.escrow) - payment).toString(),
          active: true,
        },
      }));
      setPendingSettlement(null);
      setBlockedReason(null);
      setTransaction({ label: "Usage settled and confirmed", hash, tone: "success" });
    } catch (error) {
      const message = `Settlement required before another request: ${errorText(error)}`;
      setErr(message);
      setTransaction({ label: message, hash: submittedHash, tone: "error" });
    } finally {
      setOperation(null);
    }
  }

  async function reconcileSettlement() {
    if (!pendingSettlement) return;
    setErr(null);
    try {
      const credit = await api.get<InferenceCredit>(`/credits/${pendingSettlement.creditId}`);
      const hasMeteredUsage = BigInt(pendingSettlement.promptDelta) + BigInt(pendingSettlement.completionDelta) > 0n;
      const reconciled = hasMeteredUsage
        && BigInt(credit.promptTokens) >= BigInt(pendingSettlement.promptTokens)
        && BigInt(credit.completionTokens) >= BigInt(pendingSettlement.completionTokens);
      if (!reconciled) {
        setErr("The indexed credit does not include this usage yet. Retry settlement or wait for confirmation.");
        return;
      }
      setPendingSettlement(null);
      setBlockedReason(null);
      setTransaction({ label: "Usage settlement reconciled from chain state", tone: "success" });
    } catch (error) {
      setErr(`Could not reconcile settlement: ${errorText(error)}`);
    }
  }

  async function send() {
    const prompt = input.trim();
    if (!prompt || !selectedModel || locked) return;
    if (!address) {
      await connect();
      return;
    }
    if (!selectedCredit) {
      setErr("Open or select an active credit for this model before sending a request.");
      return;
    }

    const nextMessages: Message[] = [...messages, { role: "user", content: prompt }];
    const requestId = crypto.randomUUID();
    const expiry = authorizationExpiry();
    const authorization = {
      creditId: selectedCredit.id,
      requestId,
      requester: address,
      provider: selectedCredit.provider,
      model: selectedModel,
      expiry,
    };

    setMessages(nextMessages);
    setInput("");
    setOperation("requesting");
    setErr(null);
    setTransaction({ label: "Sign the short-lived request authorization" });

    let json: ChatCompletionResponse;
    try {
      const signature = await signInferenceAuthorization(authorization, nextMessages);
      setTransaction({ label: "Authorization signed. Waiting for provider response." });
      const response = await fetch(`${ORCHESTRATOR_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          messages: nextMessages,
          temperature: 0.7,
          authorization: {
            credit_id: selectedCredit.id,
            request_id: requestId,
            requester: address,
            provider: selectedCredit.provider,
            expiry,
            signature,
          },
        }),
      });
      json = await response.json() as ChatCompletionResponse;
      if (!response.ok) throw new Error(json?.error ?? `HTTP ${response.status}`);
    } catch (error) {
      setErr(`Request failed: ${errorText(error)}`);
      setTransaction({ label: `Request failed: ${errorText(error)}`, tone: "error" });
      setOperation(null);
      return;
    }

    const content = json?.choices?.[0]?.message?.content ?? "(no content)";
    setMessages((current) => [...current, { role: "assistant", content }]);
    const promptDelta = tokenCount(json?.usage?.prompt_tokens);
    const completionDelta = tokenCount(json?.usage?.completion_tokens);
    if (promptDelta === null || completionDelta === null) {
      const message = "The provider response omitted valid prompt or completion usage. Further requests are blocked because this response cannot be settled safely.";
      setBlockedReason(message);
      setErr(message);
      setTransaction({ label: "Usage unavailable. Settlement is blocked.", tone: "error" });
      setOperation(null);
      return;
    }

    const settlement: PendingSettlement = {
      creditId: selectedCredit.id,
      promptTokens: (BigInt(selectedCredit.promptTokens) + promptDelta).toString(),
      completionTokens: (BigInt(selectedCredit.completionTokens) + completionDelta).toString(),
      promptDelta: promptDelta.toString(),
      completionDelta: completionDelta.toString(),
    };
    setLastUsage({
      prompt: promptDelta,
      completion: completionDelta,
      cost: (promptDelta + completionDelta) * BigInt(selectedCredit.pricePerToken),
    });
    setPendingSettlement(settlement);
    await submitSettlement(settlement, selectedCredit);
  }

  async function handleCloseCredit() {
    if (!address || !selectedCredit || !deploymentState.data?.contracts?.InferenceMarket || locked) return;
    setOperation("closing");
    setErr(null);
    try {
      setTransaction({ label: `Confirm closing credit #${selectedCredit.id}` });
      const hash = await closeInferenceCredit(
        address,
        deploymentState.data.contracts.InferenceMarket,
        selectedCredit.id,
      );
      setTransaction({ label: "Credit close submitted, waiting for confirmation", hash });
      await waitForTransaction(hash);
      setLocalCredits((current) => ({
        ...current,
        [selectedCredit.id]: {
          escrow: "0",
          paid: selectedCredit.paid,
          promptTokens: selectedCredit.promptTokens,
          completionTokens: selectedCredit.completionTokens,
          active: false,
        },
      }));
      setTransaction({ label: "Credit closed. Remaining escrow was refunded.", hash, tone: "success" });
    } catch (error) {
      const message = `Credit close failed: ${errorText(error)}`;
      setErr(message);
      setTransaction({ label: message, tone: "error" });
    } finally {
      setOperation(null);
    }
  }

  const apiError = offersState.error ?? creditsState.error ?? deploymentState.error;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
      <Card className="order-1 overflow-hidden">
        <CardHead title="Inference offers" sub={`${activeOffers.length} active`} />
        {offersState.loading ? (
          <Skeleton label="Loading inference offers" rows={3} />
        ) : activeOffers.length === 0 ? (
          <Empty
            icon="model"
            title="No active inference offers"
            hint="A provider must stake, pass attestation, and publish a model offer before it appears here."
          />
        ) : (
          <div className="max-h-[420px] space-y-1 overflow-auto p-2 xl:max-h-[calc(100vh-13rem)]">
            {activeOffers.map((offer) => {
              const selected = selectedOffer?.id === offer.id;
              return (
                <button
                  key={offer.id}
                  type="button"
                  onClick={() => selectOffer(offer)}
                  disabled={locked}
                  aria-pressed={selected}
                  className={`block w-full rounded-md border px-3 py-2.5 text-left transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected ? "border-accent bg-accent-weak" : "border-transparent hover:bg-hover"
                  }`}
                >
                  <span className="block truncate text-[14px] font-medium text-ink">{offer.modelIdentifier}</span>
                  <span className="mono mt-1 block text-[12px] text-accent">{pricePerThousand(offer.pricePerToken)}</span>
                  <span className="mono mt-0.5 block text-[12px] text-faint">
                    #{offer.id} · {shortAddr(offer.provider)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="order-3 flex min-h-[560px] flex-col overflow-hidden xl:order-2 xl:h-[calc(100vh-9rem)]">
        <CardHead
          title={selectedModel || "Inference playground"}
          sub={selectedCredit ? `credit #${selectedCredit.id} · ${shortAddr(selectedCredit.provider)}` : "Select an active prepaid credit"}
          action={lastUsage && (
            <span className="mono text-right text-[12px] text-faint">
              {lastUsage.prompt.toString()} in · {lastUsage.completion.toString()} out
              <b className="ml-2 font-medium text-ink2">{fmtSmesh(lastUsage.cost, 4)}</b>
            </span>
          )}
        />
        <div className="flex-1 space-y-4 overflow-auto p-5" aria-live="polite">
          {messages.length === 0 && (
            <Empty
              icon={selectedCredit ? "send" : "wallet"}
              title={selectedCredit ? "Ask the model something" : "Fund or select a credit to begin"}
              hint="Each request is signed by your wallet, routed only to the provider holding your credit, and metered per token on chain."
            />
          )}
          {messages.map((message, index) => (
            <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] whitespace-pre-wrap rounded-lg border px-3.5 py-2.5 text-[14px] leading-relaxed sm:max-w-[78%] ${
                  message.role === "user"
                    ? "border-accent bg-accent-weak text-ink"
                    : "border-line bg-panel text-ink2"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
          {operation === "requesting" && (
            <div role="status" className="flex items-center gap-2.5 text-[13px] text-muted">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted border-r-transparent" aria-hidden />
              Waiting for the credited provider
            </div>
          )}
          {err && <ErrorNote>{err}</ErrorNote>}
        </div>
        <div className="border-t border-line p-3 sm:p-4">
          {(activePendingSettlement || activeBlockedReason) && (
            <div className="mb-3 flex flex-col gap-2.5 rounded-lg border border-accent bg-accent-weak px-4 py-3 text-[13px] leading-relaxed text-ink2 sm:flex-row sm:items-center sm:justify-between">
              <span>{activeBlockedReason ?? "Usage settlement must complete before another request."}</span>
              {activePendingSettlement && (
                <span className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => selectedCredit && submitSettlement(activePendingSettlement, selectedCredit)}
                    disabled={operation !== null || !selectedCredit}
                  >
                    Retry settlement
                  </Button>
                  <Button size="sm" variant="secondary" onClick={reconcileSettlement} disabled={operation !== null}>
                    Reconcile
                  </Button>
                </span>
              )}
            </div>
          )}
          <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-end">
            <label className="sr-only" htmlFor="inference-prompt">Prompt</label>
            <textarea
              id="inference-prompt"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              disabled={locked || !selectedCredit}
              rows={2}
              placeholder={selectedCredit ? "Ask anything, or paste a prompt" : "Select an active credit first"}
              className="min-h-[46px] flex-1 resize-none rounded-md border border-line bg-bg px-3 py-2.5 text-[14px] leading-relaxed text-ink transition-colors duration-fast ease-out placeholder:text-faint hover:border-line-strong focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Button
              variant="primary"
              icon="send"
              onClick={send}
              loading={operation === "requesting" || operation === "settling"}
              disabled={locked || !selectedCredit || !input.trim()}
              className="sm:h-[46px]"
            >
              {operation === "requesting" ? "Requesting" : operation === "settling" ? "Settling" : "Send"}
            </Button>
          </div>
        </div>
      </Card>

      <div className="order-2 space-y-5 xl:order-3">
        <Card>
          <CardHead title="Prepaid credit" sub={selectedModel || "Choose an offer"} />
          <div className="space-y-4 p-4">
            {!address ? (
              <Button variant="primary" icon="wallet" className="w-full" onClick={connect}>
                Connect wallet
              </Button>
            ) : (
              <>
                <div>
                  <label htmlFor="active-credit" className="mb-1.5 block text-[13px] font-medium text-ink2">
                    Active credit
                  </label>
                  <select
                    id="active-credit"
                    value={selectedCredit?.id ?? ""}
                    onChange={(event) => setSelectedCreditId(event.target.value)}
                    disabled={locked || matchingCredits.length === 0}
                    className="mono h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] text-ink transition-colors duration-fast ease-out hover:border-line-strong disabled:opacity-50"
                  >
                    {matchingCredits.length === 0 && <option value="">No matching credit</option>}
                    {matchingCredits.map((credit) => (
                      <option key={credit.id} value={credit.id}>
                        #{credit.id} · {fmtSmesh(credit.escrow, 4)}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedCredit ? (
                  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
                    {[
                      ["Balance", fmtSmesh(selectedCredit.escrow, 4)],
                      ["Paid", fmtSmesh(selectedCredit.paid, 4)],
                      ["Prompt tokens", BigInt(selectedCredit.promptTokens).toLocaleString()],
                      ["Completion tokens", BigInt(selectedCredit.completionTokens).toLocaleString()],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-panel px-3 py-2.5">
                        <dt className="text-[12px] text-faint">{label}</dt>
                        <dd className="mono mt-0.5 truncate text-[13px] font-medium text-ink" title={value}>
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-[13px] leading-relaxed text-muted">
                    Open a credit against the selected offer, then select it once the indexer picks it up.
                  </p>
                )}

                <div className="border-t border-line pt-4">
                  <label htmlFor="credit-amount" className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-ink2">
                    <span>New credit amount</span>
                    <span className="mono font-normal text-faint">Wallet {fmtSmesh(balanceWei, 2)}</span>
                  </label>
                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Input
                        id="credit-amount"
                        value={creditAmount}
                        onChange={(event) => setCreditAmount(event.currentTarget.value)}
                        disabled={locked || !selectedOffer}
                        inputMode="decimal"
                        className="mono pr-16"
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-faint">
                        SMESH
                      </span>
                    </div>
                    <Button
                      variant="primary"
                      onClick={handleOpenCredit}
                      loading={operation === "opening"}
                      disabled={locked || !selectedOffer}
                    >
                      {operation === "opening" ? "Opening" : "Open"}
                    </Button>
                  </div>
                  {selectedOffer && (
                    <p className="mono mt-2 text-[12px] text-faint">
                      Offer #{selectedOffer.id} · {pricePerThousand(selectedOffer.pricePerToken)}
                    </p>
                  )}
                </div>

                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={handleCloseCredit}
                  loading={operation === "closing"}
                  disabled={locked || !selectedCredit}
                >
                  {operation === "closing" ? "Closing" : "Close credit and refund balance"}
                </Button>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Transaction state" sub="Requester signed" />
          <div className="p-5">
            {displayedTransaction ? (
              <div role="status" aria-live="polite">
                <p
                  className={`text-[13px] leading-relaxed ${
                    displayedTransaction.tone === "error"
                      ? "text-danger"
                      : displayedTransaction.tone === "success"
                        ? "text-success"
                        : "text-ink2"
                  }`}
                >
                  {displayedTransaction.label}
                </p>
                {displayedTransaction.hash && (
                  <p className="mono mt-2 break-all text-[12px] text-faint" title={displayedTransaction.hash}>
                    {displayedTransaction.hash}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted">
                Approval, credit, request authorization, and settlement states appear here.
              </p>
            )}
            {apiError && (
              <p role="alert" className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-danger">
                Marketplace data could not be refreshed. {apiError}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
