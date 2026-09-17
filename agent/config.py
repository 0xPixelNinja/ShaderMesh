"""Environment driven configuration for the provider agent."""

from __future__ import annotations

import os
from dataclasses import dataclass

from retry import RetryPolicy

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
    auto_faucet: bool
    poll_interval: float
    challenger: bool
    challenger_sample_rate: float
    job_memory_limit: str
    job_cpu_count: float
    job_pids_limit: int
    job_container_user: str
    job_tmpfs_size: str
    job_helper_image: str
    retry_policy: RetryPolicy

    def __post_init__(self) -> None:
        if not 0 <= self.challenger_sample_rate <= 1:
            raise ValueError("CHALLENGER_SAMPLE_RATE must be between 0 and 1")
        if self.job_cpu_count <= 0 or self.job_pids_limit <= 0:
            raise ValueError("task container CPU and PID limits must be positive")

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
            auto_faucet=os.environ.get("AUTO_FAUCET", "true").lower()
            in ("1", "true", "yes"),
            poll_interval=float(os.environ.get("POLL_INTERVAL", "5")),
            challenger=os.environ.get("CHALLENGER", "false").lower() == "true",
            challenger_sample_rate=float(
                os.environ.get("CHALLENGER_SAMPLE_RATE", "0.1")
            ),
            job_memory_limit=os.environ.get("JOB_MEMORY_LIMIT", "512m"),
            job_cpu_count=float(os.environ.get("JOB_CPU_COUNT", "1")),
            job_pids_limit=int(os.environ.get("JOB_PIDS_LIMIT", "128")),
            job_container_user=os.environ.get("JOB_CONTAINER_USER", "65532:65532"),
            job_tmpfs_size=os.environ.get("JOB_TMPFS_SIZE", "64m"),
            job_helper_image=os.environ.get("JOB_HELPER_IMAGE", "shadermesh/agent"),
            retry_policy=RetryPolicy.from_env(),
        )
