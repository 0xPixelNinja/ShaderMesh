# ShaderMesh

**A decentralized marketplace for renting compute, coordinated by Ethereum smart contracts.**

Providers stake and rent out GPU and CPU capacity. Requesters lease it to run any containerized
workload. The headline use case is AI and LLM compute: rent a GPU to run or fine-tune a model, or
call a managed, provider-served, OpenAI-compatible inference endpoint. It generalizes to any
compute. The blockchain is the trust, coordination, and payment layer, not the compute layer.

The marketplace has two modes:

- **Rental (primary).** Lease a node or GPU for a duration and run anything, including LLMs. Because
  a rented result cannot be re-executed and checked (LLM output is non-deterministic and training is
  unverifiable), trust comes from **staking, signed uptime heartbeats, hardware attestation and
  benchmark challenges, reputation, and slashing for SLA breaches**, with escrow that streams to the
  provider per interval.
- **Verifiable task (retained).** Submit a job with a checkable output (rendering, batch compute).
  Trust comes from an **optimistic verification game**: staking, reputation, randomized re-execution
  (spot-checking), and slashing.

> Course project (Blockchain / Cryptocurrency). See the full design in
> [`docs/ShaderMesh-Review1-Proposal.md`](docs/ShaderMesh-Review1-Proposal.md) and the SRS in
> [`docs/ShaderMesh-SRS.md`](docs/ShaderMesh-SRS.md).

---

## Why this is different

Centralized clouds gate GPU supply behind an oligopoly and opaque billing. Existing decentralized
networks are domain-locked (Render for rendering, Livepeer for video) or optimize only liveness
(Akash). ShaderMesh combines a **general compute-rental market** (headlined by LLM and AI compute,
with a managed inference endpoint and raw GPU leases) with a **verifiable task mode** for
deterministic jobs. One staking, reputation, and slashing layer secures both, on commodity hardware.

## Architecture (high level)

```
                         ┌──────────────── on-chain (Ethereum) ────────────────┐
  Requester ──lease──►   RentalMarket   escrow-stream · heartbeats · SLA slash  │
     │                   JobMarket      escrow · tasks · verifiable settlement   │
     │                   Verification   spot-check re-execution · disputes       │
     │                   ProviderRegistry (stake · attestation · reputation)     │
     │                   SmeshToken (ERC-20: pay · stake · rewards)              │
                         └──────────────────────────────────────────────────────┘
     │                                   ▲                          ▲
     └── call inference / manage ──► Orchestrator ──index/route──► Provider Agents
                                    (gateway, metering,           (lease serving,
                                     rental index, stitch)         LLM inference,
                                                                   Docker jobs)
                                          IPFS (inputs / outputs / manifests)
```

Full diagrams (block, state machine, sequence, roadmap) live in the proposal doc.

## Monorepo layout

| Path | What | Stack |
|------|------|-------|
| `contracts/` | Smart contracts + tests + deploy scripts | Solidity 0.8.x, Hardhat, OpenZeppelin |
| `agent/` | Provider node agent: rental serving, LLM inference, Docker jobs, heartbeats | Python 3.11+, web3.py, Docker SDK |
| `orchestrator/` | Rental index, inference gateway, job split/stitch, event index, API | Node + TypeScript, viem |
| `web/` | Requester + provider dashboard, on-chain explorer | Next.js, wagmi/viem, Tailwind |
| `simulator/` | N-provider simulation + attacker strategies | Python |
| `docs/` | Proposal, architecture, review materials | Markdown |

## Contracts

| Contract | Responsibility | Status |
|----------|----------------|--------|
| `SmeshToken` | ERC-20 utility token: payments, staking, rewards (+ testnet faucet). | built |
| `ProviderRegistry` | Registration, staking, capabilities, reputation (EMA), slashing. | built |
| `JobMarket` | Verifiable-task market: escrow, tasks, claiming, settlement. | built |
| `Verification` | Result commitments, spot-check scheduling, disputes, reward/slash. | built |
| `RentalMarket` | Rental market: lease lifecycle, streamed escrow, heartbeats, SLA slashing. | planned |
| Attestation (in `ProviderRegistry`) | Benchmark/attestation challenges proving advertised hardware. | planned |

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
docker compose up --build            # full stack, seeded, with the dashboard
```

This boots the chain, deploys the contracts, seeds real listings and an active lease,
serves a model, and publishes the dashboard. Open it at **http://localhost:3000**.

Endpoints: dashboard `:3000`, orchestrator API `:4000`, chain `:8545`,
inference provider `:8100`, IPFS `:5001` / `:8080`, Postgres `:5432`.

## Status

Built and tested: the verifiable-task path end to end (`SmeshToken`, `ProviderRegistry`, `JobMarket`,
`Verification`), the provider agent, the orchestrator, and the economic simulator. The project is
being repositioned toward compute rental with an LLM focus; the rental market, attestation, and the
managed inference layer are the next phases. See the roadmap in
[`docs/ShaderMesh-SRS.md`](docs/ShaderMesh-SRS.md).

## License

MIT (intended). Academic project.
