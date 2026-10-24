"""End to end benchmark challenge test: real provider responder and attester service.

Covers a pass that refreshes the attestation, a wrong hash that is slashed and
revoked, a silent provider slashed on expiry, a score failure judged by a fresh
attester instance (restart safety), and an unjudged answer that lapses.
"""

from __future__ import annotations

from web3 import Web3

from attester import Attester, AttesterConfig
from benchmark import respond_to_challenge
from chain import ChainClient
from conftest import RPC
from rental import RentalProvider, attest_provider

WINDOW = 600
SLASH = 10
STATUS_PASSED, STATUS_FAILED, STATUS_LAPSED = 3, 4, 5


def _wei(n: int) -> int:
    return Web3.to_wei(n, "ether")


def _advance(client: ChainClient, seconds: int) -> None:
    client.w3.provider.make_request("evm_increaseTime", [seconds])
    client.w3.provider.make_request("evm_mine", [])


class Setup:
    def __init__(self, deployment, benchmark_score: int = 100):
        self.deployment = deployment
        self.owner = ChainClient.from_unlocked_account(RPC, deployment, 0)
        self.provider = RentalProvider(
            ChainClient.from_unlocked_account(RPC, deployment, 1),
            spec='{"gpu":"RTX4090","vram":24}',
            price_per_interval=_wei(1),
            interval_secs=3600,
            stake_amount=_wei(100),
        )
        registry = self.owner.registry
        self.owner.tx(registry.functions.setChallengeParams(WINDOW, _wei(SLASH)))
        self.owner.tx(self.owner.token.functions.transfer(self.provider.chain.address, _wei(200)))
        self.provider.ensure_ready()
        attest_provider(self.owner, self.provider.chain.address, "RTX4090", 24, benchmark_score)
        self.addr = self.provider.chain.address
        self.treasury = self.owner.call(registry.functions.treasury())

    def attester(self) -> Attester:
        return Attester(
            self.owner,
            AttesterConfig(interval_secs=60, min_score_bps=5000),
            start_block=int(self.deployment["deploymentBlock"]),
        )

    def stake(self) -> int:
        return self.owner.call(self.owner.registry.functions.providers(self.addr))[2]

    def attested_at(self) -> int:
        return self.owner.call(self.owner.registry.functions.attestations(self.addr))[0]

    def challenge(self, cid: int):
        return self.owner.call(self.owner.registry.functions.challenges(cid))


def test_pass_refreshes_attestation(deployment):
    s = Setup(deployment)
    attester = s.attester()
    before = s.attested_at()
    assert attester.tick() == [f"[attester] challenge=1 provider={s.addr} outcome=issued"]
    # An open challenge is not duplicated.
    assert attester.tick() == []

    assert respond_to_challenge(s.provider.chain, fault="") == 1
    _advance(s.owner, 5)
    lines = attester.tick()
    assert len(lines) == 1 and "outcome=passed" in lines[0]
    assert s.challenge(1)[5] == STATUS_PASSED
    assert s.attested_at() > before
    assert s.stake() == _wei(100)

    # Not due again until the interval elapses.
    assert attester.tick() == []
    _advance(s.owner, 61)
    assert "outcome=issued" in attester.tick()[0]


def test_wrong_hash_is_slashed_and_revoked(deployment):
    s = Setup(deployment)
    attester = s.attester()
    attester.tick()
    treasury_before = s.owner.call(s.owner.token.functions.balanceOf(s.treasury))
    assert respond_to_challenge(s.provider.chain, fault="wrong_hash") == 1
    lines = attester.tick()
    assert "outcome=failed" in lines[0] and "mismatch" in lines[0]
    assert s.challenge(1)[5] == STATUS_FAILED
    assert s.attested_at() == 0
    assert s.stake() == _wei(100 - SLASH)
    treasury_after = s.owner.call(s.owner.token.functions.balanceOf(s.treasury))
    assert treasury_after - treasury_before == _wei(SLASH)
    assert not s.owner.call(s.owner.registry.functions.isAttested(s.addr))
    # A revoked provider is no longer challenged.
    _advance(s.owner, 3600)
    assert attester.tick() == []


def test_silent_provider_is_slashed_on_expiry(deployment):
    s = Setup(deployment)
    attester = s.attester()
    attester.tick()
    assert respond_to_challenge(s.provider.chain, fault="silent") is None
    assert attester.tick() == []  # still inside the deadline
    _advance(s.owner, WINDOW + 1)
    lines = attester.tick()
    assert "outcome=failed" in lines[0] and "expired" in lines[0]
    assert s.challenge(1)[5] == STATUS_FAILED
    assert s.attested_at() == 0
    assert s.stake() == _wei(100 - SLASH)


def test_low_score_fails_and_restart_resumes_from_chain(deployment):
    # An attested score far above what the hash chain reaches forces a score failure.
    s = Setup(deployment, benchmark_score=10**9)
    s.attester().tick()
    assert respond_to_challenge(s.provider.chain, fault="") == 1
    # A fresh Attester instance has no memory and still judges the open challenge.
    lines = s.attester().tick()
    assert "outcome=failed" in lines[0] and "below" in lines[0]
    assert s.challenge(1)[5] == STATUS_FAILED


def test_unjudged_answer_lapses_without_penalty(deployment):
    s = Setup(deployment)
    attester = s.attester()
    attester.tick()
    respond_to_challenge(s.provider.chain, fault="")
    _advance(s.owner, 2 * WINDOW + 5)
    # Past the judging window the attester can only expire it.
    lines = attester.tick()
    assert "outcome=lapsed" in lines[0]
    assert s.challenge(1)[5] == STATUS_LAPSED
    assert s.stake() == _wei(100)
    assert s.attested_at() != 0
