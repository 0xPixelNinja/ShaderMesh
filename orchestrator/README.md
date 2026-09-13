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

## Roadmap

- **P4:** job splitting (frames/tiles), IPFS pin, Postgres indexing, tile stitching.
- **P5:** REST/WebSocket API consumed by the web dashboard.

## Status

Functional **skeleton**: chain connection, deployment discovery, `JobPosted`
indexing, and a health endpoint. Splitting/stitching are marked `TODO`.
