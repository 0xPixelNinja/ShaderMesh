# ShaderMesh

ShaderMesh is an Ethereum-coordinated marketplace for renting independently operated GPU and CPU capacity. Smart contracts control escrow, provider collateral, settlement, reputation, and penalties. Workloads, model inference, indexing, and storage remain off chain.

> **Project status:** Functional research and testnet prototype. The complete local stack is reproducible with Docker Compose. The contracts are deployed and source-verified on Sepolia, and rental, inference, and deterministic-task flows have been validated on an NVIDIA provider.

## Overview

ShaderMesh uses separate trust models for workloads with different verification properties:

| Mode | Intended use | Settlement and trust model |
|------|--------------|----------------------------|
| **Compute rental** | Time-based GPU or CPU access, container workloads, fine-tuning | Manifest-bound requests, provider acceptance, prepaid escrow, strict per-interval heartbeats, stake, reputation, refunds, and SLA slashing |
| **Managed inference** | OpenAI-compatible model requests | Provider offers, requester-funded credits, wallet-signed request authorization, cumulative token metering, and requester-controlled settlement |
| **Verifiable tasks** | Deterministic rendering and batch work | Task escrow, provider bonds, result commitments, challenge voting, optimistic finalization, and slashing |

The protocol does not claim that arbitrary off-chain computation or non-deterministic model output can be proven correct on chain. Ethereum is used only where shared economic state and deterministic enforcement are required.

## Architecture

![ShaderMesh container architecture](docs/_image/ShaderMesh-Review1-Architecture.png)

| Boundary | Components | Responsibility |
|----------|------------|----------------|
| **On chain** | `SmeshToken`, `ProviderRegistry`, `RentalMarket`, `InferenceMarket`, `JobMarket`, `Verification` | Funds, stake, bonds, lifecycle state, settlement, reputation, and disputes |
| **Provider controlled** | Python agent, Ollama adapter, constrained Docker workloads | Capacity advertisement, accepted workload execution, inference, task execution, heartbeats, and benchmark answers |
| **Attester (trusted role)** | Python `attester` service | Issues, judges, and expires benchmark challenges; records attestations |
| **Untrusted coordination** | TypeScript orchestrator, Postgres projection, IPFS, HTTP/SSE API | Event indexing, discovery, routing, replay protection, split/stitch, and read APIs |
| **User controlled** | Next.js web app and browser wallet | Discovery, transaction signing, lease management, credits, provider operations, and exploration |

The orchestrator and provider agents hold no requester funds and cannot force contract settlement.

## Current Capabilities

- Pending rental requests bound to content-addressed workload manifests.
- Explicit provider acceptance before the lease clock and provider bond begin.
- Non-retroactive heartbeat evidence for each payable rental interval.
- Prepaid inference credits with EIP-191 request authorization and replay protection.
- OpenAI-compatible inference routing to the provider selected by the credited offer.
- Provider registration, staking, attestation records, listings, earnings, and availability controls.
- Recurring seeded benchmark challenges: the provider answers a 500,000-iteration SHA-256 hash chain with a score, and the attester judges it. A wrong answer or missed deadline slashes up to 10 SMESH of free stake (never bonded stake) to a treasury, revokes the attestation, and lowers reputation.
- Deterministic jobs with IPFS inputs and outputs, constrained execution, commitments, disputes, and settlement.
- Rebuildable Postgres projections with exact event cursors and bounded RPC log queries.
- Windows NVIDIA discovery, Ollama support, Docker GPU passthrough, and isolated task I/O.
- A light-first editorial web interface (light and dark themes) with a landing page at `/`, protocol diagrams, a dashboard at `/dashboard`, and requester, provider, model, lease, and explorer pages. The explorer has a Challenges tab and an event timeline.
- Local, provider-only, and Sepolia operator Compose topologies.

## Repository Layout

| Path | Purpose | Primary stack |
|------|---------|---------------|
| [`contracts/`](contracts/) | Protocol contracts, deployment, bootstrap, gas report, tests | Solidity 0.8.24, Hardhat, OpenZeppelin |
| [`agent/`](agent/) | Provider service, inference adapter, rental runtime, task worker | Python 3.11, web3.py, Docker SDK |
| [`orchestrator/`](orchestrator/) | Durable event index, API, inference gateway, split/stitch | Node 20, TypeScript, ethers, Postgres |
| [`web/`](web/) | Requester/provider dashboard and explorer | Next.js 16, React 19, viem, Tailwind |
| [`simulator/`](simulator/) | Verification and rental economics | Python standard library |
| [`jobs/`](jobs/) | Deterministic and accepted lease workloads | Python, Docker |
| [`docs/`](docs/) | Requirements, Review 1 material, demo guide, diagrams | Markdown, DOCX, PNG |

## Quick Start

### Prerequisites

- Docker Desktop or Docker Engine with Compose v2
- Node.js 20 or newer
- Python 3.11 or newer
- A browser wallet for interactive transactions

NVIDIA workloads additionally require a compatible NVIDIA driver and Docker GPU support.

### Start the local stack

```powershell
Copy-Item .env.example .env
docker compose up --build -d --wait
docker compose ps
```

The command starts a Hardhat chain, deploys all contracts, seeds listings and an accepted lease, launches a constrained workload, starts IPFS and Postgres, indexes chain events, serves inference, runs the attester, and builds the web app.

| Service | URL |
|---------|-----|
| Web app (landing page `/`, dashboard `/dashboard`, explorer `/explorer`) | `http://localhost:3000` |
| Orchestrator API | `http://localhost:4000` |
| Hardhat RPC | `http://localhost:8545` |
| Provider inference | `http://localhost:8100` |
| IPFS API / gateway | `http://localhost:5001` / `http://localhost:8080` |
| PostgreSQL | `localhost:5432` |

Useful checks:

```powershell
Invoke-RestMethod http://localhost:4000/health
docker compose exec -T orchestrator npm run smoke:inference
cd web; npm run test:e2e
```

Stop the local stack with `docker compose down`. Add `-v` only when intentionally discarding local chain, IPFS, and Postgres data.

## Component Development

```powershell
# Contracts
cd contracts
npm ci
npm run compile
npm test
npm run gas

# Provider agent
cd ..\agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
python -m pytest

# Orchestrator
cd ..\orchestrator
npm ci
npm test
npm run typecheck

# Dashboard
cd ..\web
npm ci
npm run lint
npm run typecheck
npm run build

# Economics simulator
cd ..\simulator
python -m unittest discover -v
python verification_game_sim.py
```

## Sepolia Deployment

The live contracts use Sepolia chain ID `11155111` and are source-verified on Etherscan.

| Contract | Verified address |
|----------|------------------|
| `SmeshToken` | [`0x4d08…45F1`](https://sepolia.etherscan.io/address/0x4d08515811A8b14A69aE3049278EDB04e83645F1#code) |
| `ProviderRegistry` | [`0xd723…fC3f`](https://sepolia.etherscan.io/address/0xd723DFd9E63632e9533ea1946b57AdB6d00cfC3f#code) |
| `JobMarket` | [`0x9F3B…Ee57`](https://sepolia.etherscan.io/address/0x9F3B0526A9c665F1Df423145eaACCe5b2479Ee57#code) |
| `Verification` | [`0x9949…365F`](https://sepolia.etherscan.io/address/0x994927B22613bCB8c5A25fA6386E386F250D365F#code) |
| `RentalMarket` | [`0x0Cca…3Ac3`](https://sepolia.etherscan.io/address/0x0CcaB81947Ee0Dc270908FE0cd99f280596f3Ac3#code) |
| `InferenceMarket` | [`0x108f…f9D1`](https://sepolia.etherscan.io/address/0x108fF3eaeB81592A04212F52bEe50F46a0abf9D1#code) |

Redeployed on 2026-10-24 with benchmark challenges and source-verified with `npm run verify:sepolia`. On this deployment, the RTX 4070 Laptop GPU provider registered, staked 100 SMESH, was attested, listed capacity, published a `qwen3:0.6b` offer, and passed its first benchmark challenge with a measured score of 28,919 (289 tokens per second).

Public flows validated on the previous Review 1 deployment (addresses kept in `contracts/deployments/sepolia-review1.json`, which is gitignored):

- RTX 4070 Laptop GPU provider registered, staked, attested, and listed.
- Real `qwen3:0.6b` inference routed through a prepaid credit and settled on chain.
- A manifest-bound GPU lease launched an immutable CUDA workload, produced heartbeats, settled an interval, and ended normally.
- Two deterministic render jobs executed in isolated sibling containers, settled, and stitched to IPFS.

Operator deployment is specified in [`docs/ShaderMesh-SRS.md`](docs/ShaderMesh-SRS.md), and provider setup is documented in [`agent/README.md`](agent/README.md). Use only dedicated test wallets and test ETH.

### Additional provider laptop

```powershell
python .\agent\discover_hardware.py
Copy-Item .\agent\.env.example .\agent\.env
# Fill the untracked agent/.env with the provider wallet, RPC, hardware, endpoint, and model.
docker compose --env-file .\agent\.env -f .\docker-compose.provider.yml up --build -d --wait
```

Each provider requires a unique wallet, Sepolia ETH, the public `sepolia.json` deployment descriptor, Docker Desktop, and an endpoint reachable by the operator.

## Verification

| Suite | Result |
|-------|--------|
| Contracts | 42 passing tests plus gas report |
| Provider agent | 58 passing tests |
| Orchestrator | 54 passing tests with Postgres |
| Simulator | 15 passing tests |
| Web app | Lint, typecheck, production build, and 24 Playwright checks, including browser wallet-write flows |
| Full stack | Local Compose, Sepolia inference, GPU rental, deterministic jobs, Postgres restart recovery |

GitHub Actions repeats the component suites and starts a fresh full stack for smoke and browser checks.

## Security

- Private keys and RPC credentials belong only in gitignored `.env` files.
- Browser-exposed `NEXT_PUBLIC_*` values must be safe for public disclosure.
- Provider endpoints are restricted by an explicit orchestrator hostname allowlist.
- Inference requests require a short-lived requester signature and a unique request identifier.
- Task and lease containers run without networking by default, use read-only roots and non-root users, drop capabilities, and enforce CPU, memory, PID, and temporary-storage limits.
- The provider agent controls Docker and should run on a dedicated worker host without unrelated workloads.
- Ordinary Docker isolation is not appropriate for highly confidential requester data.

See the detailed threat model and requirement traceability in the SRS.

## Known Limitations

- Benchmark challenges are judged by the attester, which is a trusted role. A benchmark proves responsiveness, key control, and throughput, not the exact GPU model.
- Availability is based on provider heartbeats; independent probes remain planned.
- Inference usage is requester-metered and cannot independently prevent under-reporting.
- Challenger selection is not yet randomized or reputation weighted.
- Verification uses exact hashes; commit-reveal and perceptual comparison remain planned. Blender rendering is future work.
- Benchmark challenges run live on Sepolia with a 15-minute answer window; the local stack uses a 120-second window for quicker demos.
- The public deployment currently has one physical provider. Multi-provider Compose support is ready for additional laptops.

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/ShaderMesh-SRS.md`](docs/ShaderMesh-SRS.md) | Authoritative requirements, trust model, phase status, and traceability |
| [`docs/ShaderMesh-Review1-Proposal.md`](docs/ShaderMesh-Review1-Proposal.md) | Review 1 proposal and architecture narrative |
| [`docs/ShaderMesh-Review1-Report.docx`](docs/ShaderMesh-Review1-Report.docx) | Historical Review 1 submission snapshot in editable DOCX format; use the SRS for current status |
| [`docs/ShaderMesh-Demo-Presentation.md`](docs/ShaderMesh-Demo-Presentation.md) | Demo sequence, operating commands, expected state, and reviewer questions |
| [`docs/_image/`](docs/_image/) | Maintained architecture and trust-boundary figures |
| [`docs/_archive/`](docs/_archive/) | Archived source rubric material |
| [`docs/_scripts/`](docs/_scripts/) | Figure-generation tooling |

## License

No open-source license is currently declared. Contact the maintainers before reuse or redistribution.
