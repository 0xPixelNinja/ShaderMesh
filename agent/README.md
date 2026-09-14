# ShaderMesh Provider Agent

The **untrusted worker** daemon. It claims tasks from `JobMarket`, executes them
off-chain in Docker (flagship: headless Blender), pins outputs to IPFS, and
commits result hashes on-chain. It can also run in **challenger mode** to
re-execute others' tasks for the verification game.

## Responsibilities

1. **Register + stake** with `ProviderRegistry` (advertise GPU/CPU capabilities).
2. **Discover & claim** open tasks (`JobMarket.claimTask`), bonding stake.
3. **Execute** the job in a sandboxed container; **pin** the artifact to IPFS.
4. **Commit** the result (`submitResult(jobId, index, keccak256(output), CID)`).
5. **Challenge** a sampled subset of others' submissions (`Verification.challenge`).

## Run (local, outside Docker)

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env    # then edit
python agent.py
```

## Run (via docker-compose)

The root `docker-compose.yml` builds this image and mounts the Docker socket so
the agent can launch Blender containers. Scale providers with:

```bash
docker compose up --build --scale agent=3
```

## Modules

| File | Responsibility |
|------|----------------|
| `config.py` | Environment driven configuration. |
| `chain.py` | web3 client, loads addresses and ABIs from the deployment file, signs, sends transactions. |
| `storage.py` | Content addressed storage: `LocalDirStorage` (tests) and `IpfsStorage` (stack). |
| `executor.py` | Job execution: `LocalExecutor` (subprocess) and `DockerExecutor` (sandboxed container). |
| `provider.py` | The `Agent`: register, stake, claim, execute, submit, challenge, discover (verifiable tasks). |
| `rental.py` | `RentalProvider` (list capacity, heartbeat active leases) and `RentalRenter` (open, settle, end, terminate). |
| `inference.py` | OpenAI-compatible endpoint (`/v1/chat/completions`, `/v1/models`) with pluggable backend (echo or Ollama) and token metering. |
| `agent.py` | Task worker entrypoint. |
| `serve_provider.py` | Provider node entrypoint: register, stake, list, serve inference, heartbeat leases. |

## Tests

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
python -m pytest tests -v
```

- `tests/test_deterministic_job.py` checks the render job is a valid, reproducible PNG.
- `tests/test_agent_integration.py` drives the verifiable-task lifecycle, including slashing.
- `tests/test_rental_integration.py` drives the rental lifecycle: list, lease, streamed
  settlement with heartbeats, refund on end, and downtime termination with a bond slash.
- `tests/test_inference.py` checks the OpenAI-compatible endpoint and its metering.

Node and deploy are shared session fixtures in `conftest.py`.

## Status

Phases 3 and 6 complete. The agent serves the verifiable-task path and the rental path end
to end against a real chain, plus an OpenAI-compatible inference endpoint. Full suite is 7
passing. See `../docs/ShaderMesh-SRS.md`.
