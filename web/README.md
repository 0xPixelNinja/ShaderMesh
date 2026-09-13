# ShaderMesh Web Dashboard

The user-facing dApp (Phase P5). Three surfaces:

- **Requester** — post jobs, fund escrow, watch tiles/frames assemble **live**, download the final render.
- **Provider** — register, stake, view earnings and reputation, toggle availability.
- **Explorer** — on-chain view of jobs, tasks, disputes, and slashing events.

## Planned stack

Next.js (App Router) + React + TypeScript + `wagmi`/`viem` + Tailwind, with
MetaMask / WalletConnect. Reads live state from the orchestrator API and the
chain; writes via the user's wallet.

## Scaffold (when starting P5)

```powershell
npm create next-app@latest . -- --ts --tailwind --eslint --app --src-dir --use-npm
npm install wagmi viem @tanstack/react-query
Copy-Item .env.example .env.local
```

## Status

Placeholder. Intentionally not yet in `docker-compose.yml` — it will be added as
a `web` service in P5. See `../docs/ShaderMesh-Review1-Proposal.md`.
