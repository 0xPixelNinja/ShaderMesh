import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { EventEmitter } from "node:events";
import { ProjectionStore } from "./store";
import { JobService } from "./jobservice";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString());
}

/**
 * Read-only HTTP API over the projection, plus a prepare helper (split + pin)
 * and a live update stream. No writes to the chain happen here.
 */
export function createApi(store: ProjectionStore, jobService: JobService, emitter?: EventEmitter) {
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
        return sendJson(res, 200, { service: "orchestrator", status: "ok", jobs: store.jobs.size });
      }

      if (path === "/jobs" && method === "GET") {
        return sendJson(res, 200, store.listJobs());
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
        const body = await readBody(req);
        if (!body.spec || !body.tilesX || !body.tilesY) {
          return sendJson(res, 400, { error: "spec, tilesX, tilesY required" });
        }
        const prepared = await jobService.prepare(body.spec, Number(body.tilesX), Number(body.tilesY));
        return sendJson(res, 200, prepared);
      }

      // --- rental market ---
      if (path === "/listings" && method === "GET") {
        return sendJson(res, 200, store.listListings());
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
      if (path === "/providers" && method === "GET") {
        return sendJson(res, 200, store.listProviders());
      }
      if (path === "/models" && method === "GET") {
        return sendJson(res, 200, store.listModels());
      }

      // --- inference gateway: route a metered request to a serving provider ---
      if (path === "/v1/chat/completions" && method === "POST") {
        const body = await readBody(req);
        if (!body.model) return sendJson(res, 400, { error: "model required" });
        const route = store.findEndpointForModel(body.model);
        if (!route || !route.listing.endpoint) {
          return sendJson(res, 503, { error: "no provider currently serving this model" });
        }
        try {
          const upstream = await fetch(`${route.listing.endpoint}/v1/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const json: any = await upstream.json();
          json.routedTo = route.listing.provider;
          return sendJson(res, upstream.status, json);
        } catch (err) {
          return sendJson(res, 502, { error: "provider unreachable", detail: String(err) });
        }
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
      return sendJson(res, 500, { error: String(err) });
    }
  });
}
