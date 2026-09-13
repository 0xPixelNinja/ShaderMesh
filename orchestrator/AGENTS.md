# AGENTS.md — orchestrator

Thin, **untrusted** coordinator (split / index / stitch). Read root `AGENTS.md` first.

## Trust boundary

Holds **no funds** and **cannot forge results**. Its worst-case failure is
degraded liveness, never loss of funds or acceptance of bad output. Do not add
custody, privileged keys, or result-acceptance logic here — that belongs on-chain.

## Rules

1. **Node 20 + TypeScript, ESM** (`"type": "module"`). Run with `tsx`; keep
   `npm run typecheck` clean.
2. Config via **environment** (`.env.example`); discover contract addresses from
   `DEPLOYMENTS_FILE`, never hard-code them.
3. Use **ethers v6**. Keep ABIs minimal (only what's indexed/called) or import
   generated ABIs; don't paste full artifacts.
4. Expose a health endpoint and log structured, prefixed lines
   (`[orchestrator] ...`). Handle chain reconnects gracefully.
5. Persist indexed state to Postgres (`DATABASE_URL`); treat it as a cache/derived
   view of the chain, which remains the source of truth.

## Commits

Scope is `orchestrator`. Examples: `feat(orchestrator): split render job into
tiles`, `feat(orchestrator): stitch verified tiles into final image`.
