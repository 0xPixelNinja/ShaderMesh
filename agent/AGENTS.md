# AGENTS.md — agent

The provider compute agent (**untrusted worker**). Read the root `AGENTS.md` first.

## Trust boundary

This process is adversarial by assumption. It may be buggy or malicious; the
system's safety must come from on-chain staking/slashing, **not** from trusting
this code. Never add logic that assumes the agent is honest.

## Rules

1. **Python 3.11+**, use type hints and `from __future__ import annotations`.
   Keep it importable without third-party deps installed (guard imports like the
   existing `web3` guard) so CI can lint the skeleton.
2. All config via **environment** (see `.env.example`); never hard-code keys,
   endpoints, or addresses. Load contract addresses from `DEPLOYMENTS_FILE`.
3. **Job inputs are untrusted.** Execute every job in a constrained Docker
   container (cpu/mem/network limits, no host mounts beyond the job workdir).
   The agent talks to the Docker daemon via the mounted socket; it launches
   sibling containers, not Docker-in-Docker.
4. Result commitments must match the on-chain policy: `keccak256(output)` for
   deterministic jobs; perceptual/SSIM comparison is a challenger concern (P2).
5. Be resilient to RPC/IPFS flakiness (retries/backoff); rely on compose
   `restart` policy for hard failures.

## Commits

Scope is `agent`. Examples: `feat(agent): execute blender task in sandboxed
container`, `fix(agent): back off on IPFS timeouts`.
