"""End to end rental test: the real Python provider and renter against a real chain.

Covers the primary market: attest, list, request and accept a lease, stream payment
per interval against heartbeats, then end with a refund; and the downtime path
where a provider that stops sending heartbeats is terminated and slashed.
"""

from __future__ import annotations

from web3 import Web3

from chain import ChainClient
from rental import (
    LEASE_ACTIVE,
    LEASE_ENDED,
    LEASE_REJECTED,
    LEASE_TERMINATED,
    RentalProvider,
    RentalRenter,
    attest_provider,
)
from conftest import RPC

HOUR = 3600
MANIFEST = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3ayu5ol5qi2ngv3a6h4q"
OTHER_MANIFEST = "ipfs://bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"


def _wei(n: int) -> int:
    return Web3.to_wei(n, "ether")


def _advance_time(client: ChainClient, seconds: int) -> None:
    client.w3.provider.make_request("evm_increaseTime", [seconds])
    client.w3.provider.make_request("evm_mine", [])


def _provider(deployment, account_index: int) -> RentalProvider:
    return RentalProvider(
        ChainClient.from_unlocked_account(RPC, deployment, account_index),
        spec='{"gpu":"RTX4090","vram":24,"region":"us-east","models":["llama-3.1-8b"]}',
        price_per_interval=_wei(1),
        interval_secs=HOUR,
        min_intervals=1,
        max_intervals=100,
        stake_amount=_wei(100),
        allowed_manifest=MANIFEST,
    )


def test_rental_streams_then_refunds_on_end(deployment):
    owner = ChainClient.from_unlocked_account(RPC, deployment, 0)
    provider = _provider(deployment, 1)
    renter = RentalRenter(ChainClient.from_unlocked_account(RPC, deployment, 2))

    owner.tx(owner.token.functions.transfer(provider.chain.address, _wei(200)))
    owner.tx(owner.token.functions.transfer(renter.chain.address, _wei(1000)))

    provider.ensure_ready()
    attest_provider(owner, provider.chain.address, "RTX4090", 24, 1000)
    listing_id = provider.create_listing()
    lease_id = renter.request_lease(listing_id, 10, MANIFEST)
    assert provider.process_pending_requests() == (1, 0)
    lease = provider.chain.rental.functions.getLease(lease_id).call()
    assert lease[12] == LEASE_ACTIVE
    assert lease[5] > 0
    assert lease[11] == _wei(50)

    assert provider.heartbeat_all() == 1
    assert provider.heartbeat_all() == 0
    for _ in range(3):
        _advance_time(provider.chain, HOUR)
        assert provider.heartbeat_all() == 1
        assert provider.heartbeat_all() == 0
    renter.settle(lease_id)

    # 200 funded, 100 staked, 3 intervals served => 103.
    assert provider.chain.token.functions.balanceOf(provider.chain.address).call() == _wei(103)

    renter.end_lease(lease_id)
    assert renter.chain.token.functions.balanceOf(renter.chain.address).call() == _wei(997)  # 1000 - 10 + 7
    lease = provider.chain.rental.functions.getLease(lease_id).call()
    assert lease[12] == LEASE_ENDED
    assert provider.chain.registry.functions.availableStake(provider.chain.address).call() == _wei(100)


def test_rental_downtime_is_terminated_and_slashed(deployment):
    owner = ChainClient.from_unlocked_account(RPC, deployment, 0)
    provider = _provider(deployment, 1)
    renter = RentalRenter(ChainClient.from_unlocked_account(RPC, deployment, 2))

    owner.tx(owner.token.functions.transfer(provider.chain.address, _wei(200)))
    owner.tx(owner.token.functions.transfer(renter.chain.address, _wei(1000)))

    provider.ensure_ready()
    attest_provider(owner, provider.chain.address, "RTX4090", 24, 1000)
    listing_id = provider.create_listing()
    lease_id = renter.request_lease(listing_id, 10, MANIFEST)
    assert provider.process_pending_requests() == (1, 0)

    # No heartbeats. Move past one interval plus grace so the lease is down.
    _advance_time(provider.chain, HOUR + 2000)
    assert provider.chain.rental.functions.isDown(lease_id).call() == True  # noqa: E712
    renter.terminate(lease_id)

    # No interval was heartbeated. Escrow is refunded and the bond is slashed.
    assert provider.chain.token.functions.balanceOf(provider.chain.address).call() == _wei(100)
    assert renter.chain.token.functions.balanceOf(renter.chain.address).call() == _wei(1050)
    assert provider.chain.registry.functions.availableStake(provider.chain.address).call() == _wei(50)
    lease = provider.chain.rental.functions.getLease(lease_id).call()
    assert lease[12] == LEASE_TERMINATED


def test_provider_rejects_non_allowlisted_manifest(deployment):
    owner = ChainClient.from_unlocked_account(RPC, deployment, 0)
    provider = _provider(deployment, 1)
    renter = RentalRenter(ChainClient.from_unlocked_account(RPC, deployment, 2))

    owner.tx(owner.token.functions.transfer(provider.chain.address, _wei(200)))
    owner.tx(owner.token.functions.transfer(renter.chain.address, _wei(1000)))
    provider.ensure_ready()
    attest_provider(owner, provider.chain.address, "RTX4090", 24, 1000)
    listing_id = provider.create_listing()

    lease_id = renter.request_lease(listing_id, 10, OTHER_MANIFEST)
    assert list(provider.pending_requests()) == [lease_id]
    assert provider.process_pending_requests() == (0, 1)

    lease = provider.chain.rental.functions.getLease(lease_id).call()
    assert lease[12] == LEASE_REJECTED
    assert lease[10] == 0
    assert lease[5] == 0
    assert lease[11] == 0
    assert renter.chain.token.functions.balanceOf(renter.chain.address).call() == _wei(1000)
