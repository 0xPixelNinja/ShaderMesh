"use client";

import { useState, type ReactNode } from "react";
import {
  createInferenceOffer,
  createRentalListing,
  deactivateInferenceOffer,
  registerProvider,
  setRentalListingAvailable,
  updateProviderCapabilities,
} from "@/lib/actions";
import { fmtInterval, fmtSmesh } from "@/lib/format";
import { Button, Empty, Field, Input, PageHeader, Section, StatusTag } from "@/components/ui";
import type { InferenceOffer, Listing } from "@/lib/types";
import { ApiWarning, ConnectPrompt, FormFooter, ProvideNav, TxNotice, textareaClass } from "../parts";
import { asBigInt, parseAmount, parseObject, useProvider, useTransactions, type ProviderData } from "../useProvider";

type Tx = ReturnType<typeof useTransactions>;

const DEFAULT_CAPABILITIES = JSON.stringify(
  { gpuModel: "NVIDIA GeForce RTX 4070 Laptop GPU", vramGB: 8, cpu: "host", models: ["gemma3:4b", "qwen3:0.6b"] },
  null,
  2,
);

function pretty(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/** Price for one hour at a per-interval price, in base units. */
function perHour(price: bigint, intervalSecs: number): bigint {
  return intervalSecs > 0 ? (price * 3600n) / BigInt(intervalSecs) : 0n;
}

export default function CapacityPage() {
  const data = useProvider();
  const tx = useTransactions();
  const { address, wallet } = data;

  return (
    <div>
      <PageHeader
        eyebrow="Provide"
        title="Capacity"
        description="What your node offers: rental listings, inference offers, and the hardware profile behind them."
      />
      <ProvideNav current="/provide/capacity" />
      <TxNotice notice={tx.notice} />
      <ApiWarning error={data.apiError} />

      {!address ? (
        <ConnectPrompt
          connect={wallet.connect}
          connecting={wallet.connecting}
          what="Connect the provider wallet to publish listings and offers or edit its hardware profile."
        />
      ) : (
        <div className="space-y-12">
          {/* An unregistered wallet starts with the profile; everything else depends on it. */}
          {!data.registered && <Hardware data={data} tx={tx} />}
          <Listings data={data} tx={tx} />
          <Offers data={data} tx={tx} />
          {data.registered && <Hardware data={data} tx={tx} />}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- listings */

function Listings({ data, tx }: { data: ProviderData; tx: Tx }) {
  const attested = data.provider;
  const [price, setPrice] = useState("0.02");
  const [interval, setIntervalSecs] = useState("60");
  const [minIntervals, setMinIntervals] = useState("1");
  const [maxIntervals, setMaxIntervals] = useState("24");
  // Prefill hardware fields from the attested profile once it loads; edits win.
  const [gpuDraft, setGpu] = useState<string | null>(null);
  const [vramDraft, setVram] = useState<string | null>(null);
  const [modelsDraft, setModels] = useState<string | null>(null);
  const gpu = gpuDraft ?? (attested?.gpu || "RTX 4070 Laptop GPU");
  const vram = vramDraft ?? String(attested?.vramGB || 8);
  const models = modelsDraft ?? (attested?.models?.length ? attested.models : ["gemma3:4b", "qwen3:0.6b"]).join(", ");
  const [region, setRegion] = useState("local");
  const [endpoint, setEndpoint] = useState("http://provider:8100");
  const rental = data.deployment?.RentalMarket;
  const reason = data.blocker ?? (!rental ? "Rental market address not loaded yet." : null);

  let hourly: bigint | null = null;
  try {
    hourly = perHour(parseAmount(price, "price"), Number(interval));
  } catch {
    hourly = null;
  }

  async function publish() {
    const account = data.address;
    if (!account || !rental) return;
    try {
      const value = parseAmount(price, "price");
      const secs = Number(interval);
      const minimum = Number(minIntervals);
      const maximum = Number(maxIntervals);
      if (![secs, minimum, maximum].every(Number.isSafeInteger) || secs <= 0 || minimum < 1 || maximum < minimum) {
        throw new Error("Use whole numbers, a positive interval, and duration bounds where maximum is at least minimum.");
      }
      const spec: Record<string, unknown> = {
        gpu: gpu.trim(),
        vram: Number(vram),
        region: region.trim(),
        models: models.split(",").map((m) => m.trim()).filter(Boolean),
      };
      if (endpoint.trim()) spec.endpoint = endpoint.trim();
      if (!spec.gpu) throw new Error("GPU is required.");
      if (!Number.isFinite(spec.vram) || Number(spec.vram) <= 0) throw new Error("VRAM must be a positive number.");
      if (!spec.region) throw new Error("Region is required.");
      if (spec.endpoint !== undefined) {
        let url: URL;
        try {
          url = new URL(String(spec.endpoint));
        } catch {
          throw new Error("Listing endpoint must be a valid HTTP or HTTPS URL.");
        }
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Listing endpoint must use HTTP or HTTPS.");
      }
      await tx.run("listing", [
        {
          prompt: "Confirm the new rental listing in your wallet.",
          write: () =>
            createRentalListing({
              account,
              rental,
              pricePerInterval: value,
              intervalSecs: secs,
              minIntervals: minimum,
              maxIntervals: maximum,
              spec: JSON.stringify(spec),
            }),
        },
      ]);
    } catch (error) {
      tx.fail(error);
    }
  }

  function toggle(listing: Listing) {
    const account = data.address;
    if (!account || !rental) return;
    void tx.run(`listing-${listing.id}`, [
      {
        prompt: `Confirm listing #${listing.id} ${listing.available ? "deactivation" : "activation"}.`,
        write: () => setRentalListingAvailable(account, rental, listing.id, !listing.available),
      },
    ]);
  }

  return (
    <Section
      title="Rental listings"
      description="Requesters lease a listing for a number of intervals. Escrow pays you per interval with a signed heartbeat."
    >
      {data.listings.length === 0 ? (
        <Empty
          icon="gpu"
          title="No rental listings yet"
          hint="Publish a listing below to make this node available for leases."
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {data.listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              busy={tx.pending === `listing-${listing.id}`}
              disabled={tx.pending !== null || !rental}
              onToggle={() => toggle(listing)}
            />
          ))}
        </ul>
      )}

      <div className="mt-10">
        <h3 className="text-[14px] font-semibold text-ink">Publish a listing</h3>
        <p className="mt-1 text-[13px] text-muted">Set a price per interval and the lease lengths you accept.</p>
        <fieldset disabled={Boolean(reason) || tx.pending !== null} className="mt-5 space-y-5">
          <legend className="sr-only">Listing terms</legend>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Field label="Price per interval (SMESH)" hint={hourly !== null ? `${fmtSmesh(hourly, 4)} per hour` : "Enter a positive amount"}>
              <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="mono" />
            </Field>
            <Field label="Interval length (seconds)" hint={Number(interval) > 0 ? `One interval is ${fmtInterval(Number(interval))}` : undefined}>
              <Input value={interval} onChange={(e) => setIntervalSecs(e.target.value)} inputMode="numeric" className="mono" />
            </Field>
            <Field label="Minimum intervals">
              <Input value={minIntervals} onChange={(e) => setMinIntervals(e.target.value)} inputMode="numeric" className="mono" />
            </Field>
            <Field label="Maximum intervals">
              <Input value={maxIntervals} onChange={(e) => setMaxIntervals(e.target.value)} inputMode="numeric" className="mono" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Field label="GPU">
              <Input value={gpu} onChange={(e) => setGpu(e.target.value)} />
            </Field>
            <Field label="VRAM (GB)">
              <Input value={vram} onChange={(e) => setVram(e.target.value)} inputMode="numeric" className="mono" />
            </Field>
            <Field label="Region">
              <Input value={region} onChange={(e) => setRegion(e.target.value)} />
            </Field>
            <Field label="Models" hint="Comma separated">
              <Input value={models} onChange={(e) => setModels(e.target.value)} className="mono" />
            </Field>
          </div>
          <Field label="Endpoint (optional)" hint="HTTP or HTTPS URL that leased workloads reach. Leave blank to omit.">
            <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="mono" placeholder="https://" />
          </Field>
        </fieldset>
        <div className="mt-5">
          <FormFooter reason={reason}>
            <Button variant="primary" onClick={publish} disabled={Boolean(reason) || (tx.pending !== null && tx.pending !== "listing")} loading={tx.pending === "listing"}>
              Publish listing
            </Button>
          </FormFooter>
        </div>
      </div>
    </Section>
  );
}

function ListingCard({ listing, busy, disabled, onToggle }: { listing: Listing; busy: boolean; disabled: boolean; onToggle: () => void }) {
  const status = listing.available ? "Active" : listing.activeLeaseId ? "Serving" : "Inactive";
  const price = asBigInt(listing.pricePerInterval);
  return (
    <li className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink" title={listing.gpu}>
            {listing.gpu || `Listing #${listing.id}`}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            <span className="mono">#{listing.id}</span>
            {listing.vramGB ? <>, <span className="mono">{listing.vramGB} GB</span></> : null}
            {listing.region ? `, ${listing.region}` : ""}
          </p>
        </div>
        <StatusTag status={status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-[13px] sm:grid-cols-4">
        <Term label="Per interval">{fmtSmesh(price)}</Term>
        <Term label="Per hour">{fmtSmesh(perHour(price, listing.intervalSecs))}</Term>
        <Term label="Interval">{fmtInterval(listing.intervalSecs)}</Term>
        <Term label="Length">{listing.minIntervals} to {listing.maxIntervals}</Term>
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="mono min-w-0 truncate text-[12px] text-faint" title={listing.models.join(", ")}>
          {listing.models.length ? listing.models.join(", ") : "No models declared"}
        </p>
        {listing.activeLeaseId === 0 ? (
          <Button size="sm" onClick={onToggle} disabled={disabled && !busy} loading={busy}>
            {listing.available ? "Deactivate" : "Activate"}
          </Button>
        ) : (
          <span className="text-[12px] text-muted">Leased as #{listing.activeLeaseId}</span>
        )}
      </div>
    </li>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-faint">{label}</dt>
      <dd className="mono mt-0.5 truncate text-ink2">{children}</dd>
    </div>
  );
}

/* ---------------------------------------------------------------- offers */

function Offers({ data, tx }: { data: ProviderData; tx: Tx }) {
  const [model, setModel] = useState("gemma3:4b");
  const [tokenPrice, setTokenPrice] = useState("0.000002");
  const market = data.deployment?.InferenceMarket;
  const reason = data.blocker ?? (!market ? "Inference market address not loaded yet." : null);
  const activeCount = data.offers.filter((o) => o.active).length;

  async function publish() {
    const account = data.address;
    if (!account || !market) return;
    try {
      const identifier = model.trim();
      if (!identifier) throw new Error("Model identifier is required.");
      const price = parseAmount(tokenPrice, "token price");
      await tx.run("offer", [
        { prompt: "Confirm the inference offer in your wallet.", write: () => createInferenceOffer(account, market, identifier, price) },
      ]);
    } catch (error) {
      tx.fail(error);
    }
  }

  function deactivate(offer: InferenceOffer) {
    const account = data.address;
    if (!account || !market) return;
    void tx.run(`offer-${offer.id}`, [
      { prompt: `Confirm offer #${offer.id} deactivation.`, write: () => deactivateInferenceOffer(account, market, offer.id) },
    ]);
  }

  let per1k: bigint | null = null;
  try {
    per1k = parseAmount(tokenPrice, "token price") * 1000n;
  } catch {
    per1k = null;
  }

  return (
    <Section
      title="Inference offers"
      description="Serve a model through the managed endpoint. Requesters prepay credit and you are paid per token."
      action={<span className="text-[13px] text-faint">{activeCount} active</span>}
    >
      {data.offers.length === 0 ? (
        <Empty icon="model" title="No inference offers yet" hint="Publish a model and a per-token price below." />
      ) : (
        <ul className="divide-y divide-line border-b border-line">
          {data.offers.map((offer) => {
            const busy = tx.pending === `offer-${offer.id}`;
            return (
              <li key={offer.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="mono truncate text-[14px] font-medium text-ink" title={offer.modelIdentifier}>{offer.modelIdentifier}</p>
                  <p className="mt-0.5 text-[12px] text-faint">Offer #{offer.id}</p>
                </div>
                <div className="text-right">
                  <p className="mono text-[13px] text-ink2">{fmtSmesh(offer.pricePerToken, 6)} per token</p>
                  <p className="mono text-[12px] text-faint">{fmtSmesh(asBigInt(offer.pricePerToken) * 1000n, 4)} per 1k</p>
                </div>
                <StatusTag status={offer.active ? "Active" : "Inactive"} />
                <div className="w-[104px] text-right">
                  {offer.active && (
                    <Button size="sm" onClick={() => deactivate(offer)} disabled={(tx.pending !== null && !busy) || !market} loading={busy}>
                      Deactivate
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-10">
        <h3 className="text-[14px] font-semibold text-ink">Publish an offer</h3>
        <p className="mt-1 text-[13px] text-muted">The model must be served by your provider agent.</p>
        <fieldset disabled={Boolean(reason) || tx.pending !== null} className="mt-5 grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Offer terms</legend>
          <Field label="Model identifier" hint="As the agent serves it, for example gemma3:4b">
            <Input value={model} onChange={(e) => setModel(e.target.value)} className="mono" />
          </Field>
          <Field label="Price per token (SMESH)" hint={per1k !== null ? `${fmtSmesh(per1k, 4)} per 1,000 tokens` : "Enter a positive amount"}>
            <Input value={tokenPrice} onChange={(e) => setTokenPrice(e.target.value)} inputMode="decimal" className="mono" />
          </Field>
        </fieldset>
        <div className="mt-5">
          <FormFooter reason={reason}>
            <Button variant="primary" onClick={publish} disabled={Boolean(reason) || (tx.pending !== null && tx.pending !== "offer")} loading={tx.pending === "offer"}>
              Publish offer
            </Button>
          </FormFooter>
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- hardware */

const PREVIEW_FIELDS: { label: string; keys: string[] }[] = [
  { label: "GPU", keys: ["gpuModel", "gpu"] },
  { label: "VRAM", keys: ["vramGB", "vram"] },
  { label: "CPU", keys: ["cpu"] },
  { label: "Region", keys: ["region"] },
  { label: "Models", keys: ["models"] },
];

function show(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Hardware({ data, tx }: { data: ProviderData; tx: Tx }) {
  const source = data.provider?.capabilities || DEFAULT_CAPABILITIES;
  const draftKey = `${data.address?.toLowerCase() ?? ""}:${source}`;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const text = drafts[draftKey] ?? pretty(source);
  const registry = data.deployment?.ProviderRegistry;

  let parsed: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try {
    parsed = parseObject(text, "Capabilities");
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  const known = new Set(PREVIEW_FIELDS.flatMap((f) => f.keys));
  const rows = parsed
    ? [
        ...PREVIEW_FIELDS.map((f) => {
          const key = f.keys.find((k) => parsed![k] !== undefined);
          const raw = key ? parsed![key] : undefined;
          const value = raw === undefined ? null : f.label === "VRAM" && typeof raw === "number" ? `${raw} GB` : show(raw);
          return { label: f.label, value };
        }),
        ...Object.entries(parsed)
          .filter(([k]) => !known.has(k))
          .map(([k, v]) => ({ label: k, value: show(v) })),
      ]
    : [];

  const reason = data.loading ? "Loading provider data." : !registry ? "Provider registry address not loaded yet." : parseError;

  async function save() {
    const account = data.address;
    if (!account || !registry) return;
    try {
      const canonical = JSON.stringify(parseObject(text, "Capabilities"));
      await tx.run("capabilities", [
        {
          prompt: data.registered ? "Confirm the capabilities update in your wallet." : "Confirm provider registration in your wallet.",
          write: () =>
            data.registered
              ? updateProviderCapabilities(account, registry, canonical)
              : registerProvider(account, registry, canonical),
        },
      ]);
    } catch (error) {
      tx.fail(error);
    }
  }

  return (
    <div id="hardware" className="scroll-mt-8">
      <Section
        title="Hardware profile"
        description={
          data.registered
            ? "The on-chain description of this node. The attester checks it against a benchmark."
            : "Registering stores this profile on chain and makes the wallet a provider."
        }
        action={
          <span className={`text-[13px] ${data.attested ? "text-success" : "text-muted"}`}>
            {data.registered ? (data.attested ? "Registered and attested" : "Registered, awaiting attestation") : "Not registered"}
          </span>
        }
      >
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Field label="Capabilities JSON" error={parseError ?? undefined} hint="Use gpuModel, vramGB, cpu, and models so the registry stays searchable.">
            <textarea
              value={text}
              onChange={(e) => setDrafts((d) => ({ ...d, [draftKey]: e.target.value }))}
              rows={9}
              spellCheck={false}
              aria-invalid={parseError ? true : undefined}
              className={`${textareaClass} ${parseError ? "border-danger" : ""}`}
            />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink2">Preview</p>
            {parsed ? (
              <dl className="divide-y divide-line border-y border-line">
                {rows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 py-2.5 text-[13px]">
                    <dt className="text-muted">{row.label}</dt>
                    <dd className={row.value === null ? "text-faint" : "mono break-words text-ink2"}>{row.value ?? "Not set"}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="border-y border-line py-3 text-[13px] text-muted">Fix the JSON to see a preview.</p>
            )}
          </div>
        </div>
        <div className="mt-5">
          <FormFooter reason={reason}>
            <Button
              variant="primary"
              onClick={save}
              disabled={Boolean(reason) || (tx.pending !== null && tx.pending !== "capabilities")}
              loading={tx.pending === "capabilities"}
            >
              {data.registered ? "Update profile" : "Register provider"}
            </Button>
          </FormFooter>
        </div>
      </Section>
    </div>
  );
}
