"""Provider agent logic: register, stake, claim, execute, submit, and challenge.

This is the untrusted worker. Its methods are small and explicit so they can be
driven directly by the integration tests and by the run loop in `agent.py`.
"""

from __future__ import annotations

import json
import random
from typing import Callable, Iterator

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

TASK_PROVIDER = 0
TASK_RESULT_HASH = 1
TASK_STATUS = 3


class Agent:
    def __init__(
        self,
        chain: ChainClient,
        storage: Storage,
        executor: Executor,
        capabilities: str = '{"cpu":"generic"}',
        stake_amount: int = Web3.to_wei(100, "ether"),
        auto_faucet: bool = True,
    ):
        self.chain = chain
        self.storage = storage
        self.executor = executor
        self.capabilities = capabilities
        self.stake_amount = stake_amount
        self.auto_faucet = auto_faucet
        self._challenge_decisions: dict[tuple[int, int, bytes], bool] = {}
        self._challenged: set[tuple[int, int]] = set()

    # --- lifecycle --------------------------------------------------------- #

    def ensure_ready(self) -> None:
        """Register and stake enough to be eligible, if not already."""
        self.chain.ensure_provider_ready(
            self.capabilities,
            self.stake_amount,
            auto_faucet=self.auto_faucet,
        )

    # --- work -------------------------------------------------------------- #

    def _task_manifest(self, job_id: int, index: int) -> dict:
        job = self.chain.call(self.chain.market.functions.getJob(job_id))
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
        if not self.chain.call(
            self.chain.registry.functions.isEligible(self.chain.address)
        ):
            raise ValueError("challenger is not eligible")
        task = self.chain.call(self.chain.market.functions.getTask(job_id, index))
        if task[TASK_STATUS] != STATUS_SUBMITTED:
            raise ValueError("task is not submitted")
        if task[TASK_PROVIDER].lower() == self.chain.address.lower():
            raise ValueError("cannot self-challenge")
        if (job_id, index) in self._challenged or self.chain.call(
            self.chain.verification.functions.hasVoted(
                job_id, index, self.chain.address
            )
        ):
            raise ValueError("task was already challenged")

        manifest = self._task_manifest(job_id, index)
        output = self.executor.run(manifest)
        result_hash = Web3.keccak(output)
        self.chain.tx(
            self.chain.verification.functions.challenge(job_id, index, result_hash)
        )
        self._challenged.add((job_id, index))
        return result_hash

    # --- discovery --------------------------------------------------------- #

    def open_tasks(self) -> Iterator[tuple[int, int]]:
        """Yield (job_id, index) for every task currently open to claim."""
        next_id = self.chain.call(self.chain.market.functions.nextJobId())
        for job_id in range(1, next_id):
            job = self.chain.call(self.chain.market.functions.getJob(job_id))
            task_count = job[2]
            for index in range(task_count):
                task = self.chain.call(
                    self.chain.market.functions.getTask(job_id, index)
                )
                if task[TASK_STATUS] == STATUS_OPEN:
                    yield job_id, index

    def claimed_tasks(self) -> Iterator[tuple[int, int]]:
        """Yield tasks claimed by this provider so restarts resume their work."""
        next_id = self.chain.call(self.chain.market.functions.nextJobId())
        for job_id in range(1, next_id):
            job = self.chain.call(self.chain.market.functions.getJob(job_id))
            for index in range(job[2]):
                task = self.chain.call(
                    self.chain.market.functions.getTask(job_id, index)
                )
                if (
                    task[TASK_STATUS] == STATUS_CLAIMED
                    and task[TASK_PROVIDER].lower() == self.chain.address.lower()
                ):
                    yield job_id, index

    def submitted_tasks(
        self,
        sample_rate: float,
        *,
        sampler: Callable[[], float] = random.random,
    ) -> Iterator[tuple[int, int]]:
        """Yield a stable sampled subset of eligible, non-self submissions."""
        if not 0 <= sample_rate <= 1:
            raise ValueError("challenge sample rate must be between 0 and 1")
        if not self.chain.call(
            self.chain.registry.functions.isEligible(self.chain.address)
        ):
            return

        next_id = self.chain.call(self.chain.market.functions.nextJobId())
        for job_id in range(1, next_id):
            job = self.chain.call(self.chain.market.functions.getJob(job_id))
            for index in range(job[2]):
                task = self.chain.call(
                    self.chain.market.functions.getTask(job_id, index)
                )
                if task[TASK_STATUS] != STATUS_SUBMITTED:
                    continue
                if task[TASK_PROVIDER].lower() == self.chain.address.lower():
                    continue
                if (job_id, index) in self._challenged:
                    continue
                if self.chain.call(
                    self.chain.verification.functions.hasVoted(
                        job_id, index, self.chain.address
                    )
                ):
                    continue

                key = (job_id, index, bytes(task[TASK_RESULT_HASH]))
                if key not in self._challenge_decisions:
                    self._challenge_decisions[key] = sampler() < sample_rate
                if self._challenge_decisions[key]:
                    yield job_id, index
