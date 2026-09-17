# ShaderMesh

A decentralized marketplace for renting compute, coordinated by Ethereum smart contracts.

Providers stake and list GPU and CPU capacity. Requesters can request provider-approved
containerized workloads or call a managed, provider-served, OpenAI-compatible inference
endpoint. The protocol targets general compute; the current agent does not execute arbitrary
requester-defined containers. The blockchain is the trust, coordination, and payment layer,
not the compute layer.

The marketplace has two modes:

- **Rental (primary).** Request a node or GPU for a duration with a content-addressed workload
  manifest. The request remains pending until the provider accepts it; only then do the lease clock,
  listing reservation, and provider bond start. Escrow streams for completed intervals in the
  contiguous heartbeat prefix. A provider can heartbeat only the current interval, so a missed
  interval cannot be covered retroactively. Attestation records, stake, reputation, refunds, and
  SLA slashing protect the requester, but the current attester remains trusted.
- **Managed inference.** Providers publish model offers through `InferenceMarket`. A requester opens
  prepaid credit for one provider and model, signs each gateway request, and submits cumulative token
  counters on chain to pay the provider. This requester-metered prototype prevents third parties and
  providers from debiting credit, but it does not independently prove usage against under-reporting.
- **Verifiable task (retained).** Submit a job with a checkable output (rendering, batch compute).
  Eligible challengers can re-execute submitted work, vote on exact result hashes, and trigger
  slashing. Random selection, reputation weighting, commit-reveal, and SSIM remain planned.

> Course project (Blockchain / Cryptocurrency). See the full design in
> [`docs/ShaderMesh-Review1-Proposal.md`](docs/ShaderMesh-Review1-Proposal.md) and the SRS in
> [`docs/ShaderMesh-SRS.md`](docs/ShaderMesh-SRS.md).

---

## Design

ShaderMesh separates availability-secured rentals from result-verifiable deterministic jobs.
Managed inference uses a dedicated prepaid credit contract. Both market modes share provider
stake and reputation while keeping computation off chain.

## Architecture (high level)

```
                         +---------------- on-chain (Ethereum) ----------------+
  Requester --lease-->   RentalMarket    requests, escrow, heartbeat settlement |
     |                   InferenceMarket offers, credits, requester settlement   |
     |                   JobMarket and Verification task escrow and disputes     |
     |                   ProviderRegistry stake, attestation, reputation         |
     |                   SmeshToken payments, stake, rewards                     |
                         +-------------------------------------------------------+
     |                                   ^                          ^
     +-- signed inference request --> Orchestrator --route------> Provider Agents
                                    (Postgres projection,        (lease serving,
                                     gateway, split/stitch)       inference,
                                                                   Docker jobs)
                                          IPFS (inputs, outputs, manifests)
```

Full diagrams (block, state machine, sequence, roadmap) live in the proposal doc.

## Monorepo layout

| Path | What | Stack |
|------|------|-------|
| `contracts/` | Smart contracts + tests + deploy scripts | Solidity 0.8.x, Hardhat, OpenZeppelin |
| `agent/` | Provider node agent: rental serving, LLM inference, Docker jobs, heartbeats | Python 3.11+, web3.py, Docker SDK |
| `orchestrator/` | Durable event projection, inference gateway, job split/stitch, API | Node 20, TypeScript, ethers, Postgres |
| `web/` | Requester + provider dashboard, on-chain explorer | Next.js, viem, Tailwind |
| `simulator/` | N-provider simulation + attacker strategies | Python |
| `docs/` | Proposal, architecture, review materials | Markdown |

## Contracts

| Contract | Responsibility | Status |
|----------|----------------|--------|
| `SmeshToken` | ERC-20 utility token: payments, staking, rewards (+ testnet faucet). | built |
| `ProviderRegistry` | Registration, staking, capabilities, reputation (EMA), slashing. | built |
| `JobMarket` | Verifiable-task market: escrow, tasks, claiming, settlement. | built |
| `Verification` | Eligible-provider result-hash voting, disputes, reward/slash. | built |
| `RentalMarket` | Rental market: lease lifecycle, streamed escrow, heartbeats, SLA slashing. | built |
| Attestation (in `ProviderRegistry`) | Attester-managed hardware records and listing eligibility. | built |
| `InferenceMarket` | Provider offers and prepaid, requester-metered inference credits. | built |

## Quick start (dev)

Prerequisites: Node 20+, npm, Python 3.11+, Docker with Compose v2.

```powershell
# 1. Contracts: install, compile, test, run a local chain
cd contracts
npm install
npx hardhat compile
npx hardhat test
npx hardhat node          # local devnet on http://127.0.0.1:8545

# 2. Provider agent
cd ../agent
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 3. Orchestrator / Web: see each folder's README
```

### Full stack with Docker Compose

Brings up the chain, deploys contracts, and starts IPFS, Postgres, the
orchestrator, one provider, the seed service, and the dashboard. Boot order is handled via healthchecks; the
`deployer` publishes contract addresses to a shared `deployments` volume.

```powershell
Copy-Item .env.example .env
docker compose up --build -d
docker compose ps --all
```

This deploys all six contracts, seeds three listings and an accepted lease, starts a
constrained container for that lease, publishes inference offers, and serves the dashboard
at `http://localhost:3000`. Postgres persists the indexed projection and exact event cursor;
the indexer restores the snapshot and replays later chain events after a restart.

Endpoints: dashboard `:3000`, orchestrator API `:4000`, chain `:8545`,
inference provider `:8100`, IPFS `:5001` / `:8080`, Postgres `:5432`.

### Provider-only Windows node

Run hardware discovery on the Windows host. It reports OS, CPU, RAM, NVIDIA GPU and
driver data, Docker availability, and Ollama availability without reading secrets.

```powershell
python .\agent\discover_hardware.py
Copy-Item .\agent\.env.example .\agent\.env
# Set the dedicated test wallet, Sepolia RPC URL, public provider endpoint,
# discovered capabilities, model list, prices, and approved manifest.
docker compose --env-file .\agent\.env -f .\docker-compose.provider.yml config --quiet
docker compose --env-file .\agent\.env -f .\docker-compose.provider.yml up --build -d
docker compose -f .\docker-compose.provider.yml logs -f provider
```

The provider process can claim faucet SMESH, register, stake, and wait for operator
attestation. After attestation it maintains one current rental listing and one correctly
priced inference offer per configured model. See [`agent/README.md`](agent/README.md) for
Docker Desktop, Ollama, GPU passthrough, and workload-isolation settings.

### Sepolia operator

Use dedicated test wallets and test ETH only. Do not put a private key in a
tracked file, a Compose file, a command line, or a browser-facing build argument.

Operator setup:

```powershell
Copy-Item .\contracts\.env.example .\contracts\.env
# Set contracts/.env SEPOLIA_RPC_URL and PRIVATE_KEY in the untracked file.
cd .\contracts
npm ci
npm run compile
npm run deploy:sepolia
cd ..

Copy-Item .\.env.example .\.env
# Set the database password, private operator RPC URL, browser-safe public RPC
# URL, public orchestrator URL, and exact provider hostname allowlist.
docker compose -f .\docker-compose.sepolia.yml config
docker compose -f .\docker-compose.sepolia.yml up --build -d
docker compose -f .\docker-compose.sepolia.yml ps
```

The deployment command creates the ignored `contracts/deployments/sepolia.json`.
Distribute that public descriptor to each provider without distributing
`contracts/.env`. Give each provider wallet enough Sepolia ETH for transactions.

After all provider logs show their registered address, configure the operator's
untracked `contracts/.env` with validated records and run the idempotent bootstrap:

```dotenv
BOOTSTRAP_PROVIDERS_JSON=[{"address":"0x0000000000000000000000000000000000000000","gpuModel":"NVIDIA GPU MODEL","vramGB":24,"benchmarkScore":"1000","fundSmesh":"100"}]
BOOTSTRAP_REQUESTER_JSON={"address":"0x0000000000000000000000000000000000000000","fundSmesh":"1000"}
```

```powershell
cd .\contracts
npm run bootstrap:sepolia
```

`fundSmesh` is a target wallet balance, so rerunning bootstrap does not repeatedly
mint the full value. Matching fresh attestations are also skipped. Provider
processes poll for attestation and then create missing listings and inference
offers without creating duplicate active records.

#### Live Sepolia deployment

The contracts are deployed on Sepolia (chain ID `11155111`):

| Contract | Address |
|----------|---------|
| `SmeshToken` | [`0x917d…f215`](https://sepolia.etherscan.io/address/0x917d2f8699b96F64BA701d380CC396992e9Ff215#code) |
| `ProviderRegistry` | [`0x4626…068C`](https://sepolia.etherscan.io/address/0x4626B2218a7663c6c8C9D9ff7552455FAa29068C#code) |
| `JobMarket` | [`0x22c3…d77e`](https://sepolia.etherscan.io/address/0x22c301cb18345687d94bD9A6Bb30344667f5d77e#code) |
| `Verification` | [`0xfd32…c660`](https://sepolia.etherscan.io/address/0xfd32f4814929aaE10f29E29C14A92B4767C4c660#code) |
| `RentalMarket` | [`0x345F…b244`](https://sepolia.etherscan.io/address/0x345F848bdAd8FE8E84DB3B13248Bb217a5BFb244#code) |
| `InferenceMarket` | [`0xebdB…08a0`](https://sepolia.etherscan.io/address/0xebdB79a6566e64747a245a7B98E02E0eA28808a0#code) |

Provider `0xfd4e4A034601991A3070bD2B9B0F6a473a5bfc76` is registered,
staked, and attested for an RTX 4070 Laptop GPU with 8 GB VRAM. It published
rental listing `#2` with 60-second intervals and inference offer `#1` for
`qwen3:0.6b`. Requester `0x7e6a268D9aa458f0deCE6280A7Eb9B86888565d8`
was funded with 1,000 test SMESH.

Live validation completed both market paths. A prepaid inference request served
36 tokens and paid `72000000000000` SMESH base units. Rental lease `#1` launched
a GPU-enabled container, recorded two heartbeats, settled one interval, and ended
normally. All Sepolia operator and provider containers reported healthy. The
Alchemy-backed indexer queried logs in 10-block chunks to stay within provider
limits.

The retained verifiable-task path also completed on Sepolia. Two deterministic
render tasks executed in isolated sibling containers, settled on chain, and stitched
to `ipfs://QmbnP5U3DCUap7RPWGueix32GmBCA62xnP9YYhJRUtPqAz`.

All six deployed contracts are source-verified on Sepolia Etherscan. Each address
in the table above links to the same verified bytecode and ABI through the
Etherscan address page.

## Verification

Current automated inventory:

| Suite | Current count | Command |
|-------|--------------:|---------|
| Contracts | 35 passing | `cd contracts; npm test` |
| Provider agent | 44 passing | `cd agent; python -m pytest` |
| Orchestrator | 48 passing with Postgres | `cd orchestrator; npm test` with `TEST_DATABASE_URL` |
| Simulator | 15 passing | `cd simulator; python -m unittest discover -v` |
| Web browser checks | 16 passing across desktop and mobile | `cd web; npm run test:e2e` against the running stack |

`.github/workflows/ci.yml` runs contract compile, tests, and gas reporting; agent tests;
orchestrator tests with Postgres and type checking; web lint, type checking, and build;
simulator tests and evaluation; then a fresh Compose stack, the signed prepaid-inference
smoke flow, and Playwright checks.

For the review narrative, live walkthrough, expected values, wallet setup, and
reviewer questions, use [`docs/ShaderMesh-Demo-Presentation.md`](docs/ShaderMesh-Demo-Presentation.md).

## Status

Built and tested: pending manifest-bound lease requests and provider acceptance, strict
per-interval heartbeats, rental escrow and SLA enforcement, prepaid inference credits and
signed gateway authorization, durable Postgres indexing, hardened task and lease workers,
the provider console and explorer, both simulator modes, and a live Sepolia deployment. The
local stack uses real contract transactions and containers with seeded identities. Sepolia
validation used an RTX 4070 Laptop GPU and inference offer `#1` for `qwen3:0.6b`. Real
benchmark verification, arbitrary requester-defined GPU workloads, commit-reveal, random
reputation-weighted challenger selection, and SSIM verification remain planned. See
[`docs/ShaderMesh-SRS.md`](docs/ShaderMesh-SRS.md).

## License

MIT (intended). Academic project.
