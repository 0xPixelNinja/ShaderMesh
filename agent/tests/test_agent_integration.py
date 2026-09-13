"""End to end agent integration test against a real local chain.

Starts a Hardhat node, deploys the contracts, then drives the real Python agent
through the full on chain lifecycle: register, stake, claim, execute a
deterministic job, submit, and settle. A second test proves a dishonest provider
is slashed by an honest challenger.

Storage uses the local backend and execution uses the local executor so the test
has no IPFS or Docker dependency. The chain, contracts, and web3 calls are real.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request

import pytest
from web3 import Web3

from chain import ChainClient
from executor import LocalExecutor
from provider import Agent
from storage import LocalDirStorage

HERE = os.path.dirname(__file__)
AGENT_DIR = os.path.dirname(HERE)
REPO = os.path.dirname(AGENT_DIR)
CONTRACTS = os.path.join(REPO, "contracts")
RENDER = os.path.join(REPO, "jobs", "deterministic", "render.py")
DEPLOY_FILE = os.path.join(CONTRACTS, "deployments", "localhost.json")
RPC = "http://127.0.0.1:8545"

# Well known public Hardhat test keys (safe to use, test only).
KEYS = {
    0: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    3: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
}

MANIFEST = {
    "job": "deterministic",
    "tasks": [
        {"width": 32, "height": 32, "re_min": -2.0, "re_max": 1.0, "im_min": -1.5, "im_max": 1.5, "max_iter": 60}
    ],
}


def _wei(n: int) -> int:
    return Web3.to_wei(n, "ether")


def _rpc_up() -> bool:
    try:
        req = urllib.request.Request(
            RPC,
            data=b'{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
            headers={"content-type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=1).read()
        return True
    except Exception:
        return False


@pytest.fixture(scope="module")
def deployment():
    started = None
    if not _rpc_up():
        started = subprocess.Popen(
            "npx hardhat node",
            cwd=CONTRACTS,
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 90
        while time.time() < deadline and not _rpc_up():
            time.sleep(1)
        if not _rpc_up():
            _kill(started)
            pytest.fail("hardhat node did not start")

    subprocess.run(
        "npx hardhat run scripts/deploy.ts --network localhost",
        cwd=CONTRACTS,
        shell=True,
        check=True,
    )
    with open(DEPLOY_FILE, "r", encoding="utf-8") as f:
        dep = json.load(f)

    yield dep

    if started is not None:
        _kill(started)


def _kill(proc: subprocess.Popen) -> None:
    if sys.platform == "win32":
        subprocess.run(
            f"taskkill /F /T /PID {proc.pid}",
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        proc.terminate()


def _advance_time(client: ChainClient, seconds: int) -> None:
    client.w3.provider.make_request("evm_increaseTime", [seconds])
    client.w3.provider.make_request("evm_mine", [])


def _post_job(requester: ChainClient, input_cid: str, reward: int) -> int:
    job_id = requester.market.functions.nextJobId().call()
    requester.tx(requester.token.functions.approve(requester.market.address, reward))
    requester.tx(requester.market.functions.postJob(input_cid, 1, reward, 0))
    return job_id


def test_happy_path_pays_provider(deployment, tmp_path):
    store = LocalDirStorage(os.path.join(str(tmp_path), "store"))
    executor = LocalExecutor(RENDER)

    requester = ChainClient(RPC, deployment, KEYS[0])  # deployer holds all SMESH
    provider = Agent(
        ChainClient(RPC, deployment, KEYS[1]), store, executor, stake_amount=_wei(100)
    )

    # Fund the provider and register/stake.
    requester.tx(requester.token.functions.transfer(provider.chain.address, _wei(200)))
    provider.ensure_ready()

    cid = store.put(json.dumps(MANIFEST).encode())
    job_id = _post_job(requester, cid, _wei(100))

    provider.claim(job_id, 0)
    provider.execute_and_submit(job_id, 0)

    _advance_time(requester, 3601)  # past the challenge window
    provider.finalize(job_id, 0)

    # 200 funded, 100 staked, 100 reward => balance 200.
    assert provider.chain.token.functions.balanceOf(provider.chain.address).call() == _wei(200)
    task = requester.market.functions.getTask(job_id, 0).call()
    assert task[3] == 4  # TaskStatus.Paid


def test_cheating_provider_is_slashed(deployment, tmp_path):
    store = LocalDirStorage(os.path.join(str(tmp_path), "store"))
    executor = LocalExecutor(RENDER)

    requester = ChainClient(RPC, deployment, KEYS[0])
    cheater = Agent(ChainClient(RPC, deployment, KEYS[2]), store, executor, stake_amount=_wei(100))
    challenger = Agent(ChainClient(RPC, deployment, KEYS[3]), store, executor, stake_amount=_wei(100))

    requester.tx(requester.token.functions.transfer(cheater.chain.address, _wei(200)))
    requester.tx(requester.token.functions.transfer(challenger.chain.address, _wei(200)))
    cheater.ensure_ready()
    challenger.ensure_ready()

    cid = store.put(json.dumps(MANIFEST).encode())
    job_id = _post_job(requester, cid, _wei(100))

    # Cheater claims but submits a fabricated result hash.
    cheater.claim(job_id, 0)
    bogus = Web3.keccak(b"fabricated-output")
    cheater.chain.tx(
        cheater.chain.market.functions.submitResult(job_id, 0, bogus, "local://fake")
    )

    # Honest challenger re-executes and disputes.
    challenger.challenge(job_id, 0)
    _advance_time(requester, 1801)  # past the vote window
    challenger.chain.tx(challenger.chain.verification.functions.resolve(job_id, 0))

    # Cheater lost 10 bond (100 -> 90 available); challenger received it (100 -> 110).
    assert cheater.chain.registry.functions.availableStake(cheater.chain.address).call() == _wei(90)
    assert challenger.chain.token.functions.balanceOf(challenger.chain.address).call() == _wei(110)
    task = requester.market.functions.getTask(job_id, 0).call()
    assert task[3] == 0  # reopened to TaskStatus.Open
