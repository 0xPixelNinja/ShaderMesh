"""End to end agent integration test for the verifiable-task path against a real chain.

Drives the real Python agent through register, stake, claim, execute a deterministic
job, submit, and settle, plus a cheating provider slashed by an honest challenger.
Storage and execution are local so the test needs no IPFS or Docker; the chain,
contracts, and web3 calls are real. Node and deploy come from conftest fixtures.
"""

from __future__ import annotations

import json
import os

from web3 import Web3

from chain import ChainClient
from executor import LocalExecutor
from provider import Agent
from storage import LocalDirStorage
from conftest import RPC, KEYS

REPO = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
RENDER = os.path.join(REPO, "jobs", "deterministic", "render.py")

MANIFEST = {
    "job": "deterministic",
    "tasks": [
        {"width": 32, "height": 32, "re_min": -2.0, "re_max": 1.0, "im_min": -1.5, "im_max": 1.5, "max_iter": 60}
    ],
}


def _wei(n: int) -> int:
    return Web3.to_wei(n, "ether")


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

    requester = ChainClient(RPC, deployment, KEYS[0])
    provider = Agent(ChainClient(RPC, deployment, KEYS[1]), store, executor, stake_amount=_wei(100))

    requester.tx(requester.token.functions.transfer(provider.chain.address, _wei(200)))
    provider.ensure_ready()

    cid = store.put(json.dumps(MANIFEST).encode())
    job_id = _post_job(requester, cid, _wei(100))

    provider.claim(job_id, 0)
    provider.execute_and_submit(job_id, 0)

    _advance_time(requester, 3601)
    provider.finalize(job_id, 0)

    assert provider.chain.token.functions.balanceOf(provider.chain.address).call() == _wei(200)
    task = requester.market.functions.getTask(job_id, 0).call()
    assert task[3] == 4  # Paid


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

    cheater.claim(job_id, 0)
    bogus = Web3.keccak(b"fabricated-output")
    cheater.chain.tx(cheater.chain.market.functions.submitResult(job_id, 0, bogus, "local://fake"))

    challenger.challenge(job_id, 0)
    _advance_time(requester, 1801)
    challenger.chain.tx(challenger.chain.verification.functions.resolve(job_id, 0))

    assert cheater.chain.registry.functions.availableStake(cheater.chain.address).call() == _wei(90)
    assert challenger.chain.token.functions.balanceOf(challenger.chain.address).call() == _wei(110)
    task = requester.market.functions.getTask(job_id, 0).call()
    assert task[3] == 0  # reopened
