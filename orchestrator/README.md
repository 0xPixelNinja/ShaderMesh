# ShaderMesh Orchestrator

A **thin, untrusted coordinator**. It splits jobs into tasks, indexes on-chain
events, assists matchmaking, pins inputs/outputs to IPFS, and stitches verified
tiles/frames into the final artifact. It holds **no funds** and **cannot forge
results** — all value movement and validation happen on-chain.

## Run (local)

```powershell
npm install
Copy-Item .env.example .env   # then edit
npm run dev
```

Health check: `GET http://localhost:4000` → `{ "service": "orchestrator", "status": "connected" }`

## Run (docker-compose)

Built and started by the root `docker-compose.yml` after `deployer` completes
(so contract addresses are available on the shared `deployments` volume).

## Modules

| File | Responsibility |
|------|----------------|
| `config.ts` | Environment configuration. |
| `storage.ts` | Content addressed storage: local and IPFS backends. |
| `splitter.ts` | Split an image into tiles with matching complex plane subregions. |
| `stitcher.ts` | Compose verified tiles into a final PNG (pngjs). |
| `store.ts` | In-memory projection of on-chain state (rebuildable from chain history). |
| `indexer.ts` | Replay and subscribe to events; `dispatch` updates the projection. |
| `jobservice.ts` | `prepare` (split + pin) and `stitchJob` (assemble final image). |
| `api.ts` | Read API and live event stream. |
| `index.ts` | Entrypoint wiring all of the above. |

## API

| Route | Purpose |
|-------|---------|
| `GET /health` | Service status. |
| `GET /jobs` | List indexed jobs. |
| `GET /jobs/:id` | Job with its tasks. |
| `GET /jobs/:id/result` | Final stitched artifact CID. |
| `POST /jobs/prepare` | Split an image and pin the manifest; returns inputCID and taskCount. |
| `GET /events` | Server sent events stream of on-chain updates. |

## Tests

```powershell
npm install
npm test         # vitest: splitter, stitcher, store, indexer, jobservice, api
npm run typecheck
```

## Status

Phase 4 complete: split, index, stitch, and API with 13 passing tests and a clean
type check. Postgres persistence of the projection is a follow up; the projection
replays from chain history on startup, which keeps it rebuildable. Live cross
service indexing is exercised by the Phase 6 full stack tests.
