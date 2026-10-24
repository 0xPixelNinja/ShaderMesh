# ShaderMesh Provider Agent

The **untrusted worker** daemon. It serves time-based compute leases and managed
inference, and it executes verifiable tasks in constrained Docker containers.
All payments, stake, and slashing remain on chain.

## Responsibilities

1. **Register + stake** with `ProviderRegistry` (advertise GPU/CPU capabilities).
2. **Discover & claim** open tasks (`JobMarket.claimTask`), bonding stake.
3. **Execute** the job in a sandboxed container; **pin** the artifact to IPFS.
4. **Commit** the result (`submitResult(jobId, index, keccak256(output), CID)`).
5. **Challenge** a sampled subset of others' submissions (`Verification.challenge`).
6. **Serve leases** by accepting only an allowlisted content-addressed manifest,
   reconciling active leases to sandboxed containers, and heartbeating healthy
   workloads once per current interval.
7. **Advertise inference** by maintaining one active `InferenceMarket` offer per
   configured model after the provider is eligible and attested.

## Run (local, outside Docker)

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env    # then edit
python agent.py
```

## Run (via docker-compose)

The root `docker-compose.yml` builds this image and mounts the Docker socket so
the provider can launch lease and verifiable-task containers:

```bash
docker compose up --build
```

The seeded lease starts a real CPU-only sibling container. The default inference
backend remains deterministic `echo`; configure Ollama separately for a real model.

## Windows provider laptop

Run the standard-library hardware probe on the Windows host before configuring a
provider. It reports only hardware and service availability. It does not inspect
or print keys, RPC credentials, or other environment values.

```powershell
python .\agent\discover_hardware.py
```

For Sepolia, place the operator-provided deployment descriptor at
`contracts/deployments/sepolia.json`, then create the untracked provider config:

```powershell
Copy-Item .\agent\.env.example .\agent\.env
# Edit agent/.env with this laptop's dedicated test wallet, public endpoint,
# discovered hardware, models, and Sepolia RPC URL.
docker compose --env-file .\agent\.env -f .\docker-compose.provider.yml config
docker compose --env-file .\agent\.env -f .\docker-compose.provider.yml up --build -d
docker compose -f .\docker-compose.provider.yml logs -f provider
```

The provider uses Docker Desktop's Linux socket to launch constrained sibling
workloads. Ollama remains on Windows and is reached through
`http://host.docker.internal:11434`. Set `INFERENCE_BACKEND=ollama` only after
the hardware probe reports Ollama available. For optional NVIDIA workloads,
enable Docker Desktop GPU support and set both `LEASE_WORKLOAD_GPU=true` and
`LEASE_GPU_ENABLED=true`. Keep both false on CPU-only laptops.

`AUTO_FAUCET=true` lets a new provider claim test SMESH when its wallet cannot
reach the configured stake. The process registers and stakes first, then waits
for operator attestation. It checks every `POLL_SECS` and publishes one rental
listing and one correctly priced offer per configured model after attestation.

### Validated Sepolia provider

Provider `0xfd4e4A034601991A3070bD2B9B0F6a473a5bfc76` was validated on Sepolia
chain `11155111` with an RTX 4070 Laptop GPU and 8 GB VRAM. It registered,
staked, received attestation, published rental listing `#2` with 60-second
intervals, and published inference offer `#1` for `qwen3:0.6b`. A live prepaid
request served 36 tokens, and rental lease `#1` launched a GPU-enabled container,
sent two heartbeats, settled one interval, and ended normally. All provider and
operator containers reported healthy.

## Inference offers

Set `MODELS` to a comma-separated list of model identifiers and set
`INFERENCE_PRICE_SMESH_PER_1K_TOKENS` to a positive decimal price per 1,000
tokens. The demo uses a 1 SMESH to 1 USD peg, so `0.002` means 0.002 SMESH/USD
per 1,000 tokens. The agent converts this value exactly to 18-decimal SMESH base
units per token and rejects values that would require rounding.

When the deployment includes `InferenceMarket`, `serve_provider.py` scans all
existing offers for its address. For each configured model it retains one active
offer at the configured price, deactivates duplicates or stale-priced offers,
and creates an offer only when needed. Restarting with unchanged configuration
does not create duplicate active offers. Offer creation waits until the provider
is both eligible and attested. The `echo` and Ollama adapters remain independent
of marketplace pricing and offer management.

## Lease workload isolation

Set `LEASE_ALLOWED_MANIFEST` to the exact `ipfs://` manifest this provider is
prepared to serve. The provider discovers pending requests, accepts a request
only when the manifest matches that value, and rejects all others. Acceptance
starts the lease and bonds provider stake on chain. If no manifest is configured,
the provider rejects every request.

Set `LEASE_WORKLOAD_IMAGE` to enable lease-bound execution. A runtime requires
`LEASE_ALLOWED_MANIFEST`, and production images must be pinned as
`name@sha256:<digest>`. The executor accepts only an array-form command and
bounded string environment variables. It does not accept mounts, privileged
mode, host devices, or network configuration from a renter.

Each workload runs with no network, a read-only root filesystem, all Linux
capabilities dropped, `no-new-privileges`, a non-root user, a small temporary
filesystem, and CPU, memory, swap, and PID limits. GPU access is disabled unless
both `LEASE_WORKLOAD_GPU` and `LEASE_GPU_ENABLED` are true. Specific devices can
be selected with `LEASE_GPU_DEVICE_IDS` when NVIDIA Container Toolkit is installed.

The on-chain request stores the manifest, but the requester cannot select the
image, command, environment, mounts, or devices. The runtime launches only the
provider-configured workload after an exact manifest match and on-chain acceptance.
It never executes arbitrary requester input.

Requesters call `RentalRenter.request_lease(listing_id, intervals, manifest)`.
The request remains pending until the provider submits `acceptLease` or
`rejectLease`. The provider sends one heartbeat for the current interval only;
polling the same interval does not submit another transaction.

## Verifiable task worker

`agent.py` runs one-shot tasks with `EXECUTOR_BACKEND=docker` by default. Each
task gets a unique, size-bounded Docker named volume mounted only at `/io`. A
short-lived trusted helper populates `manifest.json` before the untrusted task
starts. The helper, task container, and volume are always removed. No host path
is mounted. Task containers have no network, a read-only root filesystem, all capabilities dropped,
`no-new-privileges`, a non-root user, bounded `/tmp`, and CPU, memory, swap, and
PID limits. Configure these limits with `JOB_MEMORY_LIMIT`, `JOB_CPU_COUNT`,
`JOB_PIDS_LIMIT`, `JOB_CONTAINER_USER`, and `JOB_TMPFS_SIZE`. Set
`JOB_HELPER_IMAGE` to a trusted image containing Python. It defaults to the
provider image, `shadermesh/agent`. The local executor is for tests and
development without Docker.

Set `CHALLENGER=true` to inspect submitted tasks while continuing normal worker
operation. `CHALLENGER_SAMPLE_RATE` is a value from 0 to 1. Each result hash is
sampled once per process. The agent re-executes selected work and submits one
challenge vote only when its provider account is eligible, the task belongs to
another provider, and it has not already voted on chain.

RPC reads, transactions, receipt polling, and IPFS add/cat requests use bounded
exponential retry. Configure it with `RETRY_MAX_ATTEMPTS`,
`RETRY_INITIAL_DELAY_SECS`, `RETRY_MAX_DELAY_SECS`, and
`RETRY_BACKOFF_MULTIPLIER`. Contract reverts and non-transient HTTP failures are
not retried.

## Benchmark challenges

The registry attester periodically challenges attested providers to prove they are
live and performing as attested. The provider and the attester run the same
deterministic workload: `h0 = seed`, `h(i+1) = sha256(h(i))`, output `h(N)` with
`N = CHALLENGE_ITERATIONS` (`benchmark.py`). The seed comes from on-chain
randomness, so it cannot be precomputed.

- **Provider** (`serve_provider.py`): each poll it checks `openChallenge`, runs the
  workload, and calls `respondChallenge(id, score, outputHash)`. The score is
  tokens/sec x 100 on a fixed prompt when `INFERENCE_BACKEND=ollama` (first entry of
  `MODELS`), else the hash-chain rate in kH/s. Run `python benchmark.py` to print the
  score to use as the attested benchmark score.
- **Attester** (`attester.py`, run with `python attester.py`): uses the registry
  attester key. It issues a challenge to each attested provider every
  `CHALLENGE_INTERVAL_SECONDS`, recomputes the hash chain, passes a response only if the
  hash matches and the score is at least `benchmarkScore * CHALLENGE_MIN_SCORE_BPS / 10000`
  (no floor when the attested score is 0), and calls `expireChallenge` for missed
  deadlines. A failure slashes free stake to the treasury and revokes the attestation.
  State is rebuilt from `Attested` and `ChallengeIssued` events, so a restart loses nothing.
  It logs one line per action: `challenge=<id> provider=<addr> outcome=<issued|passed|failed|lapsed>`.

| Variable | Used by | Default | Meaning |
|----------|---------|---------|---------|
| `ATTESTER_PRIVATE_KEY` | attester | none | Registry attester key. Never commit it. |
| `CHALLENGE_INTERVAL_SECONDS` | attester | 300 | Minimum time between challenges per provider. |
| `CHALLENGE_MIN_SCORE_BPS` | attester | 5000 | Required share of the attested score, in basis points. |
| `ATTESTER_POLL_SECS` | attester | 15 | Loop period. |
| `ATTESTER_LOG_RANGE` | attester | 2000 | Blocks per event query (set 10 on small RPC tiers). |
| `BENCHMARK_FAULT` | provider | empty | Demo only: `wrong_hash` submits a bad hash, `silent` never responds. |

On-chain challenge window and slash amount are set at deploy time with
`CHALLENGE_WINDOW_SECONDS` and `CHALLENGE_SLASH_SMESH` (the local stack uses 120 and 10).
The local seed attests the live provider with a deliberately low score
(`DEMO_LIVE_PROVIDER_BENCHMARK`, default 100) so the echo backend (kH/s) and Ollama
(tokens/sec x 100) both pass reliably. To demo slashing, start the stack with
`BENCHMARK_FAULT=wrong_hash` or `silent`.

## Modules

| File | Responsibility |
|------|----------------|
| `config.py` | Environment driven configuration. |
| `chain.py` | web3 client, loads addresses and ABIs from the deployment file, signs, sends transactions. |
| `storage.py` | Content addressed storage: `LocalDirStorage` (tests) and `IpfsStorage` (stack). |
| `executor.py` | One-shot task execution plus recoverable, sandboxed lease containers with optional NVIDIA access. |
| `retry.py` | Shared bounded exponential retry policy and runner. |
| `discover_hardware.py` | Standard-library Windows/Linux hardware and service discovery command. |
| `provider.py` | The `Agent`: register, stake, claim, execute, submit, challenge, discover (verifiable tasks). |
| `rental.py` | `RentalProvider` (discover, accept/reject, serve, heartbeat) and `RentalRenter` (request, settle, end, terminate). |
| `inference.py` | OpenAI-compatible endpoint (`/v1/chat/completions`, `/v1/models`) with pluggable backend (echo or Ollama) and token metering. |
| `agent.py` | Task worker entrypoint. |
| `serve_provider.py` | Provider node entrypoint: register, stake, list, serve inference, heartbeat leases, answer challenges. |
| `benchmark.py` | Deterministic challenge workload, scoring, provider responder, and score CLI. |
| `attester.py` | Operator-run service that issues, judges, and expires benchmark challenges. |

## Tests

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
python -m pytest tests -v
```

The current suite has 58 passing tests.

- `tests/test_deterministic_job.py` checks the render job is a valid, reproducible PNG.
- `tests/test_agent_integration.py` drives the verifiable-task lifecycle, including slashing.
- `tests/test_rental_integration.py` drives request acceptance and rejection, streamed
  settlement with interval heartbeats, refund on end, and downtime bond slashing.
- `tests/test_inference.py` checks the OpenAI-compatible endpoint, token metering,
  exact offer pricing, and idempotent on-chain offer creation.
- `tests/test_lease_executor.py` checks sandbox controls, GPU gating, recovery labels,
  cleanup, and health-backed heartbeats without requiring Docker or a GPU.
- `tests/test_worker_safety.py` checks task sandboxing, retry classification and
  backoff, IPFS retries, and challenger sampling with fakes.
- `tests/test_benchmark.py` checks hash chain determinism, scoring, and attester judging.
- `tests/test_challenge_integration.py` drives issue, respond, and judge against a real
  chain: pass refreshes attestation, wrong hash and silence are slashed, restart safety.
- `tests/test_hardware_discovery.py` checks NVIDIA CSV and Ollama response parsing.

Node and deploy are shared session fixtures in `conftest.py`.

## Status

Phases 3 and 6 are complete. The agent serves the verifiable-task and rental paths
against a real chain, provides an OpenAI-compatible inference endpoint, and can bind
provider-approved sandboxed containers to active leases. See `../docs/ShaderMesh-SRS.md`.
