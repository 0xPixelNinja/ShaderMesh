"""Provider agent logic: register, stake, claim, execute, submit, and challenge.

This is the untrusted worker. Its methods are small and explicit so they can be
driven directly by the integration tests and by the run loop in `agent.py`.
"""

from __future__ import annotations

import json
from typing import Iterator

from web3 import Web3

from chain import ChainClient
from executor import Executor
from storage import Storage

# Task status enum values from JobMarket.TaskStatus.
STATUS_OPEN = 0
STATUS_CLAIMED = 1
STATUS_SUBMITTED = 2
STATUS_DISPUTED = 3
STATUS_PAID = 4


class Agent:
    def __init__(
        self,
        chain: ChainClient,
        storage: Storage,
        executor: Executor,
        capabilities: str = '{"cpu":"generic"}',
        stake_amount: int = Web3.to_wei(100, "ether"),
    ):
        self.chain = chain
        self.storage = storage
        self.executor = executor
        self.capabilities = capabilities
        self.stake_amount = stake_amount

    # --- lifecycle --------------------------------------------------------- #

    def ensure_ready(self) -> None:
        """Register and stake enough to be eligible, if not already."""
        p = self.chain.registry.functions.providers(self.chain.address).call()
        registered = p[0]
        stake = p[2]
        if not registered:
            self.chain.tx(self.chain.registry.functions.register(self.capabilities))
        min_stake = self.chain.registry.functions.minStake().call()
        if stake < min_stake:
            self.chain.tx(
                self.chain.token.functions.approve(
                    self.chain.registry.address, self.stake_amount
                )
            )
            self.chain.tx(self.chain.registry.functions.stake(self.stake_amount))

    # --- work -------------------------------------------------------------- #

    def _task_manifest(self, job_id: int, index: int) -> dict:
        job = self.chain.market.functions.getJob(job_id).call()
        input_cid = job[1]  # Job.inputCID
        job_manifest = json.loads(self.storage.get(input_cid))
        return job_manifest["tasks"][index]

    def claim(self, job_id: int, index: int) -> None:
        self.chain.tx(self.chain.market.functions.claimTask(job_id, index))

    def execute_and_submit(self, job_id: int, index: int) -> bytes:
        manifest = self._task_manifest(job_id, index)
        output = self.executor.run(manifest)
        out_cid = self.storage.put(output)
        result_hash = Web3.keccak(output)
        self.chain.tx(
            self.chain.market.functions.submitResult(job_id, index, result_hash, out_cid)
        )
        return result_hash

    def finalize(self, job_id: int, index: int) -> None:
        self.chain.tx(self.chain.market.functions.finalizeTask(job_id, index))

    def challenge(self, job_id: int, index: int) -> bytes:
        """Re-execute a submitted task and challenge it with the recomputed hash."""
        manifest = self._task_manifest(job_id, index)
        output = self.executor.run(manifest)
        result_hash = Web3.keccak(output)
        self.chain.tx(
            self.chain.verification.functions.challenge(job_id, index, result_hash)
        )
        return result_hash

    # --- discovery --------------------------------------------------------- #

    def open_tasks(self) -> Iterator[tuple[int, int]]:
        """Yield (job_id, index) for every task currently open to claim."""
        next_id = self.chain.market.functions.nextJobId().call()
        for job_id in range(1, next_id):
            job = self.chain.market.functions.getJob(job_id).call()
            task_count = job[2]
            for index in range(task_count):
                task = self.chain.market.functions.getTask(job_id, index).call()
                if task[3] == STATUS_OPEN:
                    yield job_id, index
