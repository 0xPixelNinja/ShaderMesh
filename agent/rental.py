"""Provider rental serving and renter helpers for the RentalMarket.

The provider side lists capacity and keeps active leases alive with heartbeats.
The renter side is a small helper used by scripts and tests to open, settle, and
end leases. All value movement is on chain; this code only sends transactions.
"""

from __future__ import annotations

import time
from typing import Iterator

from chain import ChainClient

LEASE_ACTIVE = 0
LEASE_ENDED = 1
LEASE_TERMINATED = 2


def attest_provider(
    attester: ChainClient,
    provider_address: str,
    gpu_model: str,
    vram_gb: int,
    benchmark_score: int,
) -> None:
    """Record a passed attestation. Must be sent by the registry attester."""
    attester.tx(
        attester.registry.functions.attest(provider_address, gpu_model, vram_gb, benchmark_score)
    )


class RentalProvider:
    def __init__(
        self,
        chain: ChainClient,
        spec: str,
        price_per_interval: int,
        interval_secs: int,
        min_intervals: int = 1,
        max_intervals: int = 168,
        stake_amount: int = 100 * 10**18,
        capabilities: str = '{"gpu":"generic"}',
    ):
        self.chain = chain
        self.spec = spec
        self.price = price_per_interval
        self.interval = interval_secs
        self.min_intervals = min_intervals
        self.max_intervals = max_intervals
        self.stake_amount = stake_amount
        self.capabilities = capabilities

    def ensure_ready(self) -> None:
        """Register and stake enough to be eligible."""
        reg = self.chain.registry
        p = reg.functions.providers(self.chain.address).call()
        if not p[0]:
            self.chain.tx(reg.functions.register(self.capabilities))
        min_stake = reg.functions.minStake().call()
        if p[2] < min_stake:
            self.chain.tx(self.chain.token.functions.approve(reg.address, self.stake_amount))
            self.chain.tx(reg.functions.stake(self.stake_amount))

    def create_listing(self) -> int:
        listing_id = self.chain.rental.functions.nextListingId().call()
        self.chain.tx(
            self.chain.rental.functions.createListing(
                self.price, self.interval, self.min_intervals, self.max_intervals, self.spec
            )
        )
        return int(listing_id)

    def active_leases(self) -> Iterator[int]:
        rental = self.chain.rental
        next_id = rental.functions.nextLeaseId().call()
        for lease_id in range(1, next_id):
            lease = rental.functions.getLease(lease_id).call()
            # Lease tuple: [listingId, requester, provider, price, interval, start,
            #   lastHeartbeat, fundedIntervals, settledIntervals, escrow, bond, status]
            if lease[2] == self.chain.address and lease[11] == LEASE_ACTIVE:
                yield lease_id

    def heartbeat_all(self) -> int:
        count = 0
        for lease_id in self.active_leases():
            self.chain.tx(self.chain.rental.functions.heartbeat(lease_id))
            count += 1
        return count

    def serve_forever(self, poll_secs: float = 30.0) -> None:
        while True:
            try:
                n = self.heartbeat_all()
                if n:
                    print(f"[rental] heartbeat sent for {n} active lease(s)")
            except Exception as exc:  # keep serving through transient errors
                print(f"[rental] heartbeat error: {exc}")
            time.sleep(poll_secs)


class RentalRenter:
    def __init__(self, chain: ChainClient):
        self.chain = chain

    def open_lease(self, listing_id: int, intervals: int) -> int:
        rental = self.chain.rental
        listing = rental.functions.getListing(listing_id).call()
        price = listing[1]
        escrow = price * intervals
        self.chain.tx(self.chain.token.functions.approve(rental.address, escrow))
        lease_id = rental.functions.nextLeaseId().call()
        self.chain.tx(rental.functions.openLease(listing_id, intervals))
        return int(lease_id)

    def settle(self, lease_id: int) -> None:
        self.chain.tx(self.chain.rental.functions.settle(lease_id))

    def end_lease(self, lease_id: int) -> None:
        self.chain.tx(self.chain.rental.functions.endLease(lease_id))

    def terminate(self, lease_id: int) -> None:
        self.chain.tx(self.chain.rental.functions.terminate(lease_id))
