# ShaderMesh

**A decentralized, verifiable marketplace for GPU/CPU compute — coordinated by Ethereum smart contracts.**

Requesters post containerized jobs (flagship: GPU rendering split into tiles/frames). A mesh of
staked provider nodes claims tasks, runs them off-chain in Docker, and submits result commitments
on-chain. Honesty is enforced by an **optimistic verification game**: staking + on-chain reputation
+ reputation-weighted **randomized re-execution (spot-checking)** + **slashing**. The blockchain is
the trust, coordination, and payment layer — not the compute layer.

> Course project (Blockchain / Cryptocurrency). See the full design in
> [`docs/ShaderMesh-Review1-Proposal.md`](docs/ShaderMesh-Review1-Proposal.md).

---

## Why this is different

Existing decentralized-compute networks are domain-locked (Render = rendering, Livepeer = video),
rely on heavy multi-round disputes (TrueBit), require special hardware (iExec/SGX), or optimize
liveness over correctness (Akash). **ShaderMesh** contributes a *generalized containerized job
abstraction* with a *pluggable, low-overhead optimistic verification policy*, demonstrated
end-to-end on distributed GPU rendering, on commodity hardware.

## Architecture (high level)

```
Requester ──post job + escrow──►  JobMarket (chain)  ◄──split/stitch──  Orchestrator (off-chain)
    │                                   │                                     │
    └──upload scene──► IPFS ◄───────────┼───────────pull inputs──────────► Provider Agents (Docker/Blender)
                                        │                                     │
                        Verification (chain) ◄──submit hash+CID / challenge──┘
                          │  spot-check + slash + reputation
                ProviderRegistry (stake/reputation) · SmeshToken (ERC-20)
```

Full diagrams (block, state machine, sequence, gantt) live in the proposal doc.

## Monorepo layout

| Path | What | Stack |
|------|------|-------|
| `contracts/` | Smart contracts + tests + deploy scripts | Solidity 0.8.x, Hardhat, OpenZeppelin |
| `agent/` | Provider compute agent (claim → Docker → IPFS → submit) | Python 3.11+, web3.py, Docker SDK |
| `orchestrator/` | Job splitting, event indexing, tile stitching, API | Node + TypeScript, viem |
| `web/` | Requester + provider dashboard, on-chain explorer | Next.js, wagmi/viem, Tailwind |
| `simulator/` | N-provider simulation + attacker strategies | Python |
| `docs/` | Proposal, architecture, review materials | Markdown |

## Contracts

| Contract | Responsibility |
|----------|----------------|
| `SmeshToken` | ERC-20 utility token: payments, staking, verification rewards (+ testnet faucet). |
| `ProviderRegistry` | Provider registration, staking, capabilities, reputation (EMA), slashing. |
| `JobMarket` | Job posting, escrow, task metadata, claiming, state machine, settlement. |
| `Verification` | Result commitments, spot-check scheduling, dispute resolution, reward/slash. |

## Quick start (dev)

Prerequisites: Node 18+, npm/pnpm, Python 3.11+, Docker.

```powershell
# 1. Contracts: install, compile, test, run a local chain
cd contracts
npm install
npx hardhat compile
npx hardhat test
npx hardhat node          # local devnet on http://127.0.0.1:8545

# 2. (later) Provider agent
cd ../agent
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 3. (later) Orchestrator / Web — see each folder's README
```

### Full stack with Docker Compose

Brings up the chain, deploys contracts, and starts IPFS, Postgres, the
orchestrator, and provider agents. Boot order is handled via healthchecks; the
`deployer` publishes contract addresses to a shared `deployments` volume.

```powershell
Copy-Item .env.example .env          # adjust as needed (test values only)
docker compose up --build            # full stack
docker compose up --build --scale agent=3   # 3 provider nodes
```

Endpoints: chain `:8545`, IPFS API `:5001` / gateway `:8080`, Postgres `:5432`,
orchestrator health `:4000`.

## Status

Early scaffold. **Review 1 (proposal & design) is complete.** Implementation follows the phase plan
in the proposal (P1 contracts → P2 verification game → P3 agent → P4 orchestrator → …).

## License

MIT (intended). Academic project.
