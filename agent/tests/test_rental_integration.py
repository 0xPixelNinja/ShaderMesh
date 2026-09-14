"""End to end rental test: the real Python provider and renter against a real chain.

Covers the primary market: attest, list, open a lease, stream payment per interval
against heartbeats, then end with a refund; and the downtime path where a provider
that stops sending heartbeats is terminated and slashed.
"""

from __future__ import annotations

from web3 import Web3

from chain import ChainClient
from rental import RentalProvider, RentalRenter, attest_provider
from conftest import RPC, KEYS

HOUR = 3600


def _wei(n: int) -> int:
    return Web3.to_wei(n, "ether")


def _advance_time(client: ChainClient, seconds: int) -> None:
    client.w3.provider.make_request("evm_increaseTime", [seconds])
    client.w3.provider.make_request("evm_mine", [])


def _provider(deployment, key: str) -> RentalProvider:
    return RentalProvider(
        ChainClient(RPC, deployment, key),
        spec='{"gpu":"RTX4090","vram":24,"region":"us-east","models":["llama-3.1-8b"]}',
        price_per_interval=_wei(1),
        interval_secs=HOUR,
        min_intervals=1,
        max_intervals=100,
        stake_amount=_wei(100),
    )


def test_rental_streams_then_refunds_on_end(deployment):
    owner = ChainClient(RPC, deployment, KEYS[0])  # attester and treasury
    provider = _provider(deployment, KEYS[1])
    renter = RentalRenter(ChainClient(RPC, deployment, KEYS[2]))

    owner.tx(owner.token.functions.transfer(provider.chain.address, _wei(200)))
    owner.tx(owner.token.functions.transfer(renter.chain.address, _wei(1000)))

    provider.ensure_ready()
    attest_provider(owner, provider.chain.address, "RTX4090", 24, 1000)
    listing_id = provider.create_listing()
    lease_id = renter.open_lease(listing_id, 10)

    _advance_time(provider.chain, 3 * HOUR)
    provider.heartbeat_all()
    renter.settle(lease_id)

    # 200 funded, 100 staked, 3 intervals served => 103.
    assert provider.chain.token.functions.balanceOf(provider.chain.address).call() == _wei(103)

    renter.end_lease(lease_id)
    assert renter.chain.token.functions.balanceOf(renter.chain.address).call() == _wei(997)  # 1000 - 10 + 7
    lease = provider.chain.rental.functions.getLease(lease_id).call()
    assert lease[11] == 1  # Ended
    assert provider.chain.registry.functions.availableStake(provider.chain.address).call() == _wei(100)


def test_rental_downtime_is_terminated_and_slashed(deployment):
    owner = ChainClient(RPC, deployment, KEYS[0])
    provider = _provider(deployment, KEYS[1])
    renter = RentalRenter(ChainClient(RPC, deployment, KEYS[2]))

    owner.tx(owner.token.functions.transfer(provider.chain.address, _wei(200)))
    owner.tx(owner.token.functions.transfer(renter.chain.address, _wei(1000)))

    provider.ensure_ready()
    attest_provider(owner, provider.chain.address, "RTX4090", 24, 1000)
    listing_id = provider.create_listing()
    lease_id = renter.open_lease(listing_id, 10)

    # No heartbeats. Move past one interval plus grace so the lease is down.
    _advance_time(provider.chain, HOUR + 2000)
    assert provider.chain.rental.functions.isDown(lease_id).call() == True  # noqa: E712
    renter.terminate(lease_id)

    # 1 interval served, then bond (50) slashed to the renter.
    assert provider.chain.token.functions.balanceOf(provider.chain.address).call() == _wei(101)
    assert renter.chain.token.functions.balanceOf(renter.chain.address).call() == _wei(1049)
    assert provider.chain.registry.functions.availableStake(provider.chain.address).call() == _wei(50)
    lease = provider.chain.rental.functions.getLease(lease_id).call()
    assert lease[11] == 2  # Terminated
