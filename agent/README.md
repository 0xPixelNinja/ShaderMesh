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

## Status

Functional **skeleton** (`agent.py`): config loading, RPC connection, ABI wiring,
and the loop structure are in place; IPFS I/O and container execution are
marked `TODO` for Phase P3. See `../docs/ShaderMesh-Review1-Proposal.md`.
