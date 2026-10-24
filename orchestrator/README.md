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

`DATABASE_URL` is required. The orchestrator creates its cache tables on startup.
Health check: `GET http://localhost:4000/health`. It returns HTTP `503` and
`status: "degraded"` when database persistence or chain indexing fails.

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
| `store.ts` | In-memory projection and versioned, complete snapshot format. |
| `persistence.ts` | Postgres projection snapshots, exact event cursors, and inference replay keys. |
| `indexer.ts` | Restore, ordered replay, durable event application, and live catch-up. |
| `jobservice.ts` | `prepare` (split + pin) and `stitchJob` (assemble final image). |
| `api.ts` | Read API and live event stream. |
| `index.ts` | Entrypoint wiring all of the above. |

## API

| Route | Purpose |
|-------|---------|
| `GET /health` | Service status. |
| `GET /listings` | Available GPU rental offers, including duration bounds. |
| `GET /leases` and `GET /leases/:id` | Rental leases and their state. |
| `GET /providers` | Providers with registration, stake, reputation, capabilities, attestation, served models, and challenge summary (`challengesPassed`, `challengesFailed`, `lastChallenge`). |
| `GET /challenges` and `GET /challenges/:id` | Benchmark challenges with status, score, output hash, slashed amount, and per-phase block and transaction. Use `?provider=0x...` to filter the collection. |
| `GET /models` | Model catalog aggregated from available listings. |
| `GET /offers` and `GET /offers/:id` | Inference offers projected from `InferenceMarket`. |
| `GET /credits` and `GET /credits/:id` | Prepaid inference credits. Use `?requester=0x...` to filter the collection. |
| `POST /v1/chat/completions` | Authorized OpenAI-compatible gateway pinned to the credited provider. |
| `GET /jobs` and `GET /jobs/:id` | Verifiable jobs and tasks. |
| `GET /tasks` | All verifiable tasks. |
| `GET /disputes` | Verification disputes with votes and outcomes. |
| `GET /jobs/:id/result` | Final stitched artifact CID. |
| `POST /jobs/prepare` | Split an image and pin the manifest; returns inputCID and taskCount. |
| `GET /events` | Server sent events stream of on-chain updates, including `ChallengeIssued`, `ChallengeResponded`, `ChallengeResolved`, and `AttestationRevoked`. |
| `GET /events/history` | Recent indexed events. Use `?type=EventName&limit=100` to filter. |

### Benchmark challenges

A challenge record has the shape `{ id, provider, seed, issuedAt, deadline, status, score,
outputHash, slashed, issued, responded, resolved }`. `status` is one of `open`, `responded`,
`passed`, `failed`, or `lapsed`. `issuedAt` and the `timestamp` of each phase reference
(`{ blockNumber, transactionHash, timestamp }`) are block times, or null when the RPC could
not supply them. `score` and `outputHash` are null until the provider responds, and
`slashed` is a base-unit string. A passed challenge refreshes the provider `attested` flag,
while a failed one clears it (the chain also emits `AttestationRevoked`). A challenge slash
takes free stake only, so the projection leaves `bonded` unchanged for it.

### Inference authorization

`POST /v1/chat/completions` accepts the normal `model` and `messages` fields plus:

```json
{
  "authorization": {
    "credit_id": "1",
    "request_id": "client-generated-unique-id",
    "requester": "0x...",
    "provider": "0x...",
    "expiry": 1789600000,
    "signature": "0x..."
  }
}
```

The requester signs the following UTF-8 string with EIP-191 `personal_sign` or
ethers `signMessage`:

```text
ShaderMesh Inference Authorization v1
{"creditId":"1","expiry":1789600000,"messagesHash":"0x...","model":"model-name","provider":"0x...","requestId":"client-generated-unique-id","requester":"0x..."}
```

Fields appear in the exact order shown. Addresses are lowercase, `creditId` is a
canonical decimal string, and `messagesHash` is `keccak256` of the UTF-8 compact
JSON representation of `messages`. Object keys are sorted recursively and array
order is preserved. `canonicalRequestAuthorization` and `hashMessages` in
`src/authorization.ts` provide the reference implementation.

The credit must be active, have nonzero escrow, and match the signer, provider,
and offer model. A request ID can be used once per requester until its expiry.
Replay keys are consumed atomically in Postgres and remain effective across
orchestrator restarts. Expired keys are deleted during consumption and can also
be removed through the replay store cleanup API.
The authorization object is not forwarded upstream. Responses preserve provider
`usage` and include a `credit` object with the projected balance and route
metadata. The orchestrator does not settle usage, move funds, or hold keys.

### Gateway controls

| Variable | Default | Purpose |
|----------|---------|---------|
| `REQUEST_BODY_LIMIT_BYTES` | `1048576` | Maximum JSON request body size. |
| `PROVIDER_FETCH_TIMEOUT_MS` | `30000` | Provider response timeout. |
| `PROVIDER_HOST_ALLOWLIST` | `provider` | Exact provider endpoint hostnames allowed from on-chain listing metadata. Add `localhost` or `127.0.0.1` explicitly for host-based development. |

Provider endpoints must use HTTP or HTTPS, must not contain credentials, must
match the hostname allowlist, and cannot redirect. The default supports Docker
Compose without allowing arbitrary on-chain URLs.

## Tests

```powershell
npm install
npm test         # vitest: splitter, stitcher, store, indexer, jobservice, api
npm run typecheck
```

The Postgres integration test is skipped by default. Supply a disposable test
database to run it:

```powershell
$env:TEST_DATABASE_URL="postgres://shadermesh:shadermesh@localhost:5432/shadermesh_test"
npm test
```

## Persistence model

Postgres stores one complete projection snapshot and an exact `(block number,
log index)` cursor for each deployment identity. The identity consists of the
chain ID and normalized contract-address map. Startup restores that snapshot,
replays only events strictly after its cursor in chain order, starts one bounded
poll loop, and runs a second catch-up to close the replay/poll race. Every event
updates and saves a candidate snapshot and cursor before it becomes visible to
API and event-stream consumers. Snapshots include typed disputes and the latest
1,000 indexed events in chain order for explorer queries.

The database is only a derived cache. Dropping the two `orchestrator_*` tables is
safe: the next startup rebuilds the projection from chain events. Inference
authorization replay keys are operational security state, not chain state, and
are intentionally durable until their signed expiry.

Set `INDEXER_BLOCK_RANGE` to bound each historical log query. Each chunk issues
one all-event query per contract, then parses known events and applies them in
exact block and log order. The live Alchemy-backed Sepolia deployment uses
`INDEXER_BLOCK_RANGE=10`.

`INDEXER_POLL_INTERVAL_MS` controls the single live block poll (default `4000`).
Transient rate-limit, network, and timeout failures retry with bounded exponential
backoff. Configure the bound with `INDEXER_RPC_RETRY_ATTEMPTS` (default `3`) and
the initial delay with `INDEXER_RPC_RETRY_INTERVAL_MS` (default `1000`). Exhausted
retries degrade `/health`; a later successful poll restores indexing health.

## Status

The orchestrator supports split, durable index, stitch, rental and inference
projections, and the authorized inference gateway. Live cross-service indexing
is exercised by the full-stack tests and the healthy Sepolia operator deployment.
The current suite has 54 passing tests when run with Postgres.
