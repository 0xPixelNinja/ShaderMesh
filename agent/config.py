"""Environment driven configuration for the provider agent."""

from __future__ import annotations

import os
from dataclasses import dataclass

# 100 SMESH, expressed in wei-like base units, without importing web3 here.
_DEFAULT_STAKE = 100 * 10**18


def _default_render_script() -> str:
    return os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "jobs", "deterministic", "render.py")
    )


@dataclass
class Config:
    rpc_url: str
    deployments_file: str
    private_key: str
    storage_backend: str  # "local" or "ipfs"
    storage_root: str
    ipfs_api_url: str
    executor_backend: str  # "local" or "docker"
    render_script: str
    job_image: str
    capabilities: str
    stake_amount: int
    poll_interval: float
    challenger: bool

    @staticmethod
    def from_env() -> "Config":
        return Config(
            rpc_url=os.environ.get("RPC_URL", "http://127.0.0.1:8545"),
            deployments_file=os.environ.get(
                "DEPLOYMENTS_FILE", "../contracts/deployments/docker.json"
            ),
            private_key=os.environ.get("PROVIDER_PRIVATE_KEY", ""),
            storage_backend=os.environ.get("STORAGE_BACKEND", "ipfs"),
            storage_root=os.environ.get("STORAGE_ROOT", "./data"),
            ipfs_api_url=os.environ.get("IPFS_API_URL", "http://127.0.0.1:5001"),
            executor_backend=os.environ.get("EXECUTOR_BACKEND", "docker"),
            render_script=os.environ.get("RENDER_SCRIPT", _default_render_script()),
            job_image=os.environ.get("JOB_IMAGE", "shadermesh/job-deterministic"),
            capabilities=os.environ.get("CAPABILITIES", '{"cpu":"generic"}'),
            stake_amount=int(os.environ.get("STAKE_AMOUNT", str(_DEFAULT_STAKE))),
            poll_interval=float(os.environ.get("POLL_INTERVAL", "5")),
            challenger=os.environ.get("CHALLENGER", "false").lower() == "true",
        )
