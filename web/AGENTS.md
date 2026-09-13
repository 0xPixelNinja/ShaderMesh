# AGENTS.md — web

Requester/provider dashboard + explorer (Next.js, planned). Read root `AGENTS.md` first.

## Rules

1. **Next.js (App Router) + TypeScript + wagmi/viem + Tailwind.** All writes go
   through the user's wallet (MetaMask/WalletConnect) — the app never holds keys.
2. Only `NEXT_PUBLIC_*` env vars reach the client, and they must be
   **public-safe** (no secrets). See `.env.example`.
3. Read live state from the chain and the orchestrator API; the chain is the
   source of truth for jobs, tasks, disputes, and slashing.
4. Keep components accessible and responsive; show real-time task/tile progress.

## Commits

Scope is `web`. Examples: `feat(web): live tile-assembly view for requesters`,
`feat(web): provider staking and reputation panel`.
