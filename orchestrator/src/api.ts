import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { EventEmitter } from "node:events";
import { getAddress, verifyMessage } from "ethers";
import { EVENT_HISTORY_CAPACITY, ProjectionStore } from "./store";
import { JobService } from "./jobservice";
import { canonicalRequestAuthorization, type RequestAuthorization } from "./authorization";
import { InMemoryReplayStore, type ReplayStore } from "./persistence";
import type { ServiceHealth } from "./health";

export interface ApiOptions {
  requestBodyLimitBytes?: number;
  providerFetchTimeoutMs?: number;
  providerHostAllowlist?: string[];
  now?: () => number;
  replayStore?: ReplayStore;
  health?: ServiceHealth;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(data);
}

async function readBody(req: IncomingMessage, limit: number): Promise<any> {
  const declaredLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new HttpError(413, "request body too large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

function parseAuthorization(body: any): RequestAuthorization & { signature: string } {
  const input = body?.authorization;
  if (!input || typeof input !== "object") throw new HttpError(400, "authorization required");
  if (typeof input.credit_id !== "string" || !/^[1-9]\d*$/.test(input.credit_id)) {
    throw new HttpError(400, "authorization.credit_id must be a positive decimal string");
  }
  if (typeof input.request_id !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.request_id)) {
    throw new HttpError(400, "authorization.request_id is invalid");
  }
  if (!Number.isSafeInteger(input.expiry) || input.expiry <= 0) {
    throw new HttpError(400, "authorization.expiry must be a Unix timestamp");
  }
  if (typeof input.signature !== "string") throw new HttpError(400, "authorization.signature required");
  if (typeof body.model !== "string" || body.model.length === 0) throw new HttpError(400, "model required");
  if (!Array.isArray(body.messages)) throw new HttpError(400, "messages must be an array");

  try {
    return {
      creditId: BigInt(input.credit_id).toString(),
      requestId: input.request_id,
      requester: getAddress(input.requester),
      provider: getAddress(input.provider),
      model: body.model,
      expiry: input.expiry,
      signature: input.signature,
    };
  } catch {
    throw new HttpError(400, "authorization addresses are invalid");
  }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** Addresses that only resolve on the machine the provider itself runs on. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function providerUrl(endpoint: string, allowedHosts: Set<string>): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HttpError(502, "provider endpoint is invalid");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new HttpError(502, "provider endpoint protocol or credentials are not allowed");
  }
  if (!allowedHosts.has(normalizeHost(url.hostname))) {
    throw new HttpError(502, "provider endpoint host is not allowed");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/chat/completions`;
  url.search = "";
  url.hash = "";
  return url;
}

/**
 * Read-only HTTP API over the projection, plus a prepare helper (split + pin)
 * and a live update stream. No writes to the chain happen here.
 */
export function createApi(
  store: ProjectionStore,
  jobService: JobService,
  emitter?: EventEmitter,
  deployment?: { chainId: number; contracts: Record<string, string> },
  options: ApiOptions = {}
) {
  const bodyLimit = options.requestBodyLimitBytes ?? 1_048_576;
  const providerTimeout = options.providerFetchTimeoutMs ?? 30_000;
  const allowedHosts = new Set(
    (options.providerHostAllowlist ?? ["provider"]).map(normalizeHost)
  );
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const replayStore = options.replayStore ?? new InMemoryReplayStore();

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        return res.end();
      }

      if (path === "/health") {
        const health = options.health?.report() ?? { status: "ok" as const };
        return sendJson(res, health.status === "ok" ? 200 : 503, {
          service: "orchestrator",
          ...health,
          jobs: store.jobs.size,
          offers: store.offers.size,
          credits: store.credits.size,
        });
      }

      if (path === "/deployment" && method === "GET") {
        return sendJson(res, 200, deployment ?? { chainId: 0, contracts: {} });
      }

      if (path === "/jobs" && method === "GET") {
        return sendJson(res, 200, store.listJobs());
      }

      if (path === "/tasks" && method === "GET") {
        return sendJson(res, 200, store.listTasks());
      }

      if (path === "/disputes" && method === "GET") {
        return sendJson(res, 200, store.listDisputes());
      }

      const jobMatch = path.match(/^\/jobs\/(\d+)$/);
      if (jobMatch && method === "GET") {
        const id = Number(jobMatch[1]);
        const job = store.getJob(id);
        if (!job) return sendJson(res, 404, { error: "job not found" });
        return sendJson(res, 200, { job, tasks: store.listTasks(id) });
      }

      const resultMatch = path.match(/^\/jobs\/(\d+)\/result$/);
      if (resultMatch && method === "GET") {
        const id = Number(resultMatch[1]);
        const job = store.getJob(id);
        if (!job) return sendJson(res, 404, { error: "job not found" });
        return sendJson(res, 200, { resultCID: job.resultCID });
      }

      if (path === "/jobs/prepare" && method === "POST") {
        const body = await readBody(req, bodyLimit);
        if (!body.spec || !body.tilesX || !body.tilesY) {
          return sendJson(res, 400, { error: "spec, tilesX, tilesY required" });
        }
        const prepared = await jobService.prepare(body.spec, Number(body.tilesX), Number(body.tilesY));
        return sendJson(res, 200, prepared);
      }

      // --- rental market ---
      if (path === "/listings" && method === "GET") {
        return sendJson(res, 200, store.listListings(url.searchParams.get("all") !== "true"));
      }
      if (path === "/leases" && method === "GET") {
        return sendJson(res, 200, store.listLeases());
      }
      const leaseMatch = path.match(/^\/leases\/(\d+)$/);
      if (leaseMatch && method === "GET") {
        const lease = store.getLease(Number(leaseMatch[1]));
        if (!lease) return sendJson(res, 404, { error: "lease not found" });
        return sendJson(res, 200, lease);
      }

      // Connection details for an interactive lease, fetched from the provider
      // that is serving it. The orchestrator holds no credentials of its own; it
      // only forwards to the allowlisted host recorded in the listing.
      const leaseAccessMatch = path.match(/^\/leases\/(\d+)\/access$/);
      if (leaseAccessMatch && method === "GET") {
        const leaseId = Number(leaseAccessMatch[1]);
        const lease = store.getLease(leaseId);
        if (!lease) return sendJson(res, 404, { error: "lease not found" });
        if (lease.status !== "Active") {
          return sendJson(res, 409, { error: "lease is not active" });
        }
        const listing = store.listings.get(lease.listingId);
        if (!listing?.endpoint) {
          return sendJson(res, 404, { error: "provider publishes no endpoint" });
        }
        const upstream = new URL(`/leases/${leaseId}/access`, providerUrl(listing.endpoint, allowedHosts));
        try {
          const response = await fetch(upstream, {
            signal: AbortSignal.timeout(providerTimeout),
            redirect: "error",
          });
          const payload = await response.json().catch(() => ({ error: "provider returned invalid JSON" })) as Record<string, unknown>;
          // A provider reports the address it publishes the lease on. A loopback
          // address is only meaningful on the provider's own machine, so answer
          // with the host the requester actually used to reach this API. That
          // keeps the connection string correct from another device on the
          // network without pinning an address that changes with the network.
          if (response.ok && LOOPBACK_HOSTS.has(String(payload.host ?? "").toLowerCase())) {
            const reachedHost = (req.headers.host ?? "").replace(/:\d+$/, "").trim();
            if (reachedHost) payload.host = reachedHost;
          }
          return sendJson(res, response.status, payload);
        } catch {
          return sendJson(res, 502, { error: "provider did not answer" });
        }
      }
      if (path === "/providers" && method === "GET") {
        return sendJson(res, 200, store.listProviders());
      }
      if (path === "/models" && method === "GET") {
        return sendJson(res, 200, store.listModels());
      }

      // --- inference market ---
      if (path === "/offers" && method === "GET") {
        return sendJson(res, 200, store.listOffers());
      }
      const offerMatch = path.match(/^\/offers\/(\d+)$/);
      if (offerMatch && method === "GET") {
        const offer = store.getOffer(offerMatch[1]);
        if (!offer) return sendJson(res, 404, { error: "offer not found" });
        return sendJson(res, 200, offer);
      }
      if (path === "/credits" && method === "GET") {
        const requester = url.searchParams.get("requester") ?? undefined;
        if (requester) {
          try {
            getAddress(requester);
          } catch {
            return sendJson(res, 400, { error: "invalid requester address" });
          }
        }
        return sendJson(res, 200, store.listCredits(requester));
      }
      const creditMatch = path.match(/^\/credits\/(\d+)$/);
      if (creditMatch && method === "GET") {
        const credit = store.getCredit(creditMatch[1]);
        if (!credit) return sendJson(res, 404, { error: "credit not found" });
        return sendJson(res, 200, credit);
      }

      // --- inference gateway: authorize prepaid use and pin routing to its provider ---
      if (path === "/v1/chat/completions" && method === "POST") {
        const body = await readBody(req, bodyLimit);
        const authorization = parseAuthorization(body);
        const timestamp = now();
        if (authorization.expiry <= timestamp) throw new HttpError(401, "request authorization expired");

        const credit = store.getCredit(authorization.creditId);
        const offer = credit ? store.getOffer(credit.offerId) : null;
        if (!credit || !credit.active || BigInt(credit.escrow) === 0n) {
          throw new HttpError(403, "active prepaid credit required");
        }
        if (
          !offer
          || credit.requester.toLowerCase() !== authorization.requester.toLowerCase()
          || credit.provider.toLowerCase() !== authorization.provider.toLowerCase()
          || offer.provider.toLowerCase() !== authorization.provider.toLowerCase()
          || offer.modelIdentifier !== authorization.model
        ) {
          throw new HttpError(403, "credit does not match requester, provider, and model");
        }

        let signer: string;
        try {
          signer = verifyMessage(canonicalRequestAuthorization(authorization, body.messages), authorization.signature);
        } catch {
          throw new HttpError(401, "invalid request signature");
        }
        if (signer.toLowerCase() !== authorization.requester.toLowerCase()) {
          throw new HttpError(401, "invalid request signature");
        }

        const replayKey = `${authorization.requester.toLowerCase()}:${authorization.requestId}`;

        const route = store.findEndpointForProviderModel(authorization.provider, authorization.model);
        if (!route || !route.listing.endpoint) {
          throw new HttpError(503, "credited provider is not serving this model");
        }
        const upstreamUrl = providerUrl(route.listing.endpoint, allowedHosts);
        let consumed: boolean;
        try {
          consumed = await replayStore.consume(replayKey, authorization.expiry, timestamp);
          options.health?.recover("persistence");
        } catch (error) {
          options.health?.fail("persistence", error);
          throw error;
        }
        if (!consumed) throw new HttpError(409, "request_id already used");

        const { authorization: _authorization, ...providerBody } = body;
        try {
          const upstream = await fetch(upstreamUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(providerBody),
            signal: AbortSignal.timeout(providerTimeout),
            redirect: "error",
          });
          const json: any = await upstream.json();
          if (!json || typeof json !== "object" || Array.isArray(json)) {
            throw new Error("provider returned a non-object JSON response");
          }
          return sendJson(res, upstream.status, {
            ...json,
            usage: json.usage ?? null,
            credit: {
              id: credit.id,
              offerId: credit.offerId,
              requester: credit.requester,
              provider: credit.provider,
              model: offer.modelIdentifier,
              pricePerToken: credit.pricePerToken,
              remainingEscrow: credit.escrow,
              requestId: authorization.requestId,
            },
          });
        } catch (err) {
          const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          throw new HttpError(timedOut ? 504 : 502, timedOut ? "provider request timed out" : "provider unreachable");
        }
      }

      if (path === "/events/history" && method === "GET") {
        const rawLimit = url.searchParams.get("limit");
        if (rawLimit !== null && !/^[1-9]\d*$/.test(rawLimit)) {
          return sendJson(res, 400, { error: "limit must be a positive integer" });
        }
        const limit = Math.min(rawLimit === null ? 100 : Number(rawLimit), EVENT_HISTORY_CAPACITY);
        const type = url.searchParams.get("type") || undefined;
        return sendJson(res, 200, store.listEventHistory(type, limit));
      }

      if (path === "/events" && method === "GET") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*",
        });
        res.write(": connected\n\n");
        const onUpdate = (u: unknown) => res.write(`data: ${JSON.stringify(u)}\n\n`);
        emitter?.on("update", onUpdate);
        req.on("close", () => emitter?.off("update", onUpdate));
        return;
      }

      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      return sendJson(res, 500, { error: String(err) });
    }
  });
}
