#!/usr/bin/env python3
"""
ShaderMesh Provider Compute Agent (entrypoint).

The untrusted worker daemon. It registers and stakes, discovers open tasks,
executes them off chain (deterministic job now, Blender in Phase 7), stores the
output, and commits the result hash on chain. It can also run in challenger mode
to re-execute others' work for the verification game.

Trust model: this process is adversarial by assumption. Safety comes from on
chain staking and slashing, not from trusting this code.

The reusable logic lives in `chain.py`, `storage.py`, `executor.py`, and
`provider.py`. This file wires them together from environment configuration.
"""

from __future__ import annotations

import time

from config import Config


def build_agent(cfg: Config):
    # Imported lazily so this module stays importable without third party deps.
    from chain import ChainClient, load_deployment
    from executor import make_executor
    from provider import Agent
    from storage import make_storage

    deployment = load_deployment(cfg.deployments_file)
    chain = ChainClient(cfg.rpc_url, deployment, cfg.private_key)
    storage = make_storage(
        cfg.storage_backend, root=cfg.storage_root, ipfs_api_url=cfg.ipfs_api_url
    )
    executor = make_executor(
        cfg.executor_backend, render_script=cfg.render_script, image=cfg.job_image
    )
    return Agent(
        chain,
        storage,
        executor,
        capabilities=cfg.capabilities,
        stake_amount=cfg.stake_amount,
    )


def main() -> None:
    cfg = Config.from_env()
    print(f"[agent] starting; rpc={cfg.rpc_url} executor={cfg.executor_backend} storage={cfg.storage_backend}")

    if not cfg.private_key:
        print("[agent] no PROVIDER_PRIVATE_KEY set; nothing to do. Exiting.")
        return

    agent = build_agent(cfg)
    agent.ensure_ready()
    print(f"[agent] ready as provider {agent.chain.address}")

    while True:
        try:
            for job_id, index in agent.open_tasks():
                print(f"[agent] claiming job {job_id} task {index}")
                try:
                    agent.claim(job_id, index)
                    agent.execute_and_submit(job_id, index)
                    print(f"[agent] submitted job {job_id} task {index}")
                except Exception as exc:  # keep the loop alive on per task errors
                    print(f"[agent] task {job_id}:{index} failed: {exc}")
        except Exception as exc:
            print(f"[agent] discovery error: {exc}")
        time.sleep(cfg.poll_interval)


if __name__ == "__main__":
    main()
