#!/usr/bin/env python3
"""
ShaderMesh — Provider Compute Agent
===================================

A provider node daemon. It watches the JobMarket for open tasks, claims work,
executes it off-chain inside a sandboxed Docker container (flagship: headless
Blender), pins the output to IPFS, commits the result hash on-chain, and can act
as a *challenger* that re-executes others' work for the verification game.

Trust model: this agent is the untrusted "worker". All value movement and
result validation happen on-chain in JobMarket / Verification.

STATUS: functional skeleton. The on-chain plumbing (web3) and container execution
are wired as clearly-marked stages; fill in the TODOs during Phase P3.

Config via environment (see .env.example):
    RPC_URL                 Ethereum JSON-RPC endpoint
    DEPLOYMENTS_FILE        Path to deploy output (contract addresses)
    PROVIDER_PRIVATE_KEY    Provider account key (test key only)
    IPFS_API_URL            IPFS (Kubo) HTTP API
    CAPABILITIES            Free-form JSON describing hardware
    POLL_INTERVAL           Seconds between market polls
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

# Third-party (declared in requirements.txt): web3, docker, requests
try:
    from web3 import Web3
except ImportError:  # allow importing this module without deps installed
    Web3 = None  # type: ignore


# Minimal ABIs for the calls this agent makes. Full ABIs are emitted by
# `hardhat compile` under contracts/artifacts; we embed just what we use.
JOB_MARKET_ABI = json.loads(
    """
    [
      {"anonymous":false,"inputs":[
        {"indexed":true,"name":"jobId","type":"uint256"},
        {"indexed":true,"name":"requester","type":"address"},
        {"indexed":false,"name":"inputCID","type":"string"},
        {"indexed":false,"name":"taskCount","type":"uint32"},
        {"indexed":false,"name":"rewardPerTask","type":"uint256"},
        {"indexed":false,"name":"verificationPolicy","type":"uint8"}],
       "name":"JobPosted","type":"event"},
      {"inputs":[{"name":"jobId","type":"uint256"},{"name":"index","type":"uint32"}],
       "name":"claimTask","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"name":"jobId","type":"uint256"},{"name":"index","type":"uint32"},
        {"name":"resultHash","type":"bytes32"},{"name":"outputCID","type":"string"}],
       "name":"submitResult","outputs":[],"stateMutability":"nonpayable","type":"function"}
    ]
    """
)


@dataclass
class Config:
    rpc_url: str
    deployments_file: str
    private_key: str
    ipfs_api_url: str
    capabilities: str
    poll_interval: float

    @staticmethod
    def from_env() -> "Config":
        return Config(
            rpc_url=os.environ.get("RPC_URL", "http://127.0.0.1:8545"),
            deployments_file=os.environ.get("DEPLOYMENTS_FILE", "../contracts/deployments/docker.json"),
            private_key=os.environ.get("PROVIDER_PRIVATE_KEY", ""),
            ipfs_api_url=os.environ.get("IPFS_API_URL", "http://127.0.0.1:5001"),
            capabilities=os.environ.get("CAPABILITIES", '{"gpu":"unknown","vram":"0"}'),
            poll_interval=float(os.environ.get("POLL_INTERVAL", "5")),
        )


def load_addresses(path: str) -> dict:
    data = json.loads(Path(path).read_text())
    return data["contracts"]


def hash_output(data: bytes) -> bytes:
    """Result commitment for deterministic jobs (keccak-style via sha3_256 here).

    NOTE: on-chain we compare against keccak256; for perceptual (GPU) policies this
    is replaced by an SSIM/pHash comparison performed by challengers (Phase P2).
    """
    return hashlib.sha3_256(data).digest()


# --------------------------------------------------------------------------- #
# Execution stages (Phase P3 fill-in)
# --------------------------------------------------------------------------- #

def ipfs_get(cfg: Config, cid: str) -> bytes:
    """Fetch input bytes from IPFS. TODO: use the Kubo /api/v0/cat endpoint."""
    raise NotImplementedError("wire IPFS cat")


def ipfs_add(cfg: Config, data: bytes) -> str:
    """Pin output bytes to IPFS and return the CID. TODO: /api/v0/add."""
    raise NotImplementedError("wire IPFS add")


def run_render_task(cfg: Config, input_bytes: bytes, task_index: int) -> bytes:
    """Run the job in a sandboxed Docker container and return the artifact bytes.

    Flagship: `blender -b scene.blend -f <frame>` in a pinned image. Generic jobs
    run an arbitrary container declared in the job manifest.
    TODO: use the docker SDK against the mounted /var/run/docker.sock.
    """
    raise NotImplementedError("wire Docker/Blender execution")


# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #

def main() -> None:
    cfg = Config.from_env()
    print(f"[agent] starting; rpc={cfg.rpc_url} ipfs={cfg.ipfs_api_url}")

    if Web3 is None:
        print("[agent] web3 not installed - this is a skeleton run. Exiting.")
        return

    w3 = Web3(Web3.HTTPProvider(cfg.rpc_url))
    if not w3.is_connected():
        print("[agent] cannot reach RPC; retrying is left to the orchestrator/compose restart policy")
        return

    addresses = load_addresses(cfg.deployments_file)
    market = w3.eth.contract(address=addresses["JobMarket"], abi=JOB_MARKET_ABI)
    print(f"[agent] connected. JobMarket={addresses['JobMarket']}")

    # TODO(P3):
    #   1. Ensure registered + staked (ProviderRegistry.register/stake) if not already.
    #   2. Subscribe to JobPosted; for each task index, attempt claimTask().
    #   3. On successful claim: ipfs_get(inputCID) -> run_render_task() -> ipfs_add()
    #      -> submitResult(jobId, index, keccak256(output), outputCID).
    #   4. Challenger mode: sample submitted tasks, re-execute, Verification.challenge().
    last_block = w3.eth.block_number
    while True:
        # Placeholder poll loop; replaced by event-driven claiming in P3.
        time.sleep(cfg.poll_interval)
        current = w3.eth.block_number
        if current != last_block:
            print(f"[agent] block {current}; (task discovery TODO)")
            last_block = current


if __name__ == "__main__":
    main()
