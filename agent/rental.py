"""Provider rental serving and renter helpers for the RentalMarket.

The provider accepts only requests for its configured content-addressed
manifest, then keeps accepted leases alive with one heartbeat per interval. All
value movement is on chain; this code only sends transactions.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time
from dataclasses import replace
from typing import Callable, Iterator

from chain import ChainClient
from executor import LeaseExecutor, LeaseWorkload

LEASE_PENDING = 0
LEASE_ACTIVE = 1
LEASE_ENDED = 2
LEASE_TERMINATED = 3
LEASE_REJECTED = 4
LEASE_CANCELLED = 5

LEASE_LISTING = 0
LEASE_PROVIDER = 2
LEASE_INTERVAL_SECS = 4
LEASE_START = 5
LEASE_FUNDED_INTERVALS = 6
LEASE_HEARTBEATED_INTERVALS = 8
LEASE_STATUS = 12
LEASE_MANIFEST = 13

LISTING_AVAILABLE = 5
LISTING_ACTIVE_LEASE = 6

_IPFS_MANIFEST = re.compile(r"ipfs://(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})")


def is_content_addressed_manifest(manifest: str) -> bool:
    """Return whether a manifest is an exact IPFS content-addressed URI."""
    return bool(_IPFS_MANIFEST.fullmatch(manifest))


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
        allowed_manifest: str | None = None,
        lease_executor: LeaseExecutor | None = None,
        lease_workload: LeaseWorkload | None = None,
        auto_faucet: bool = True,
        ssh_secret: str = "",
        ssh_host: str = "localhost",
    ):
        if (lease_executor is None) != (lease_workload is None):
            raise ValueError("lease executor and workload must be configured together")
        if allowed_manifest is not None and not is_content_addressed_manifest(allowed_manifest):
            raise ValueError("allowed lease manifest must be an IPFS content-addressed URI")
        if lease_executor is not None and allowed_manifest is None:
            raise ValueError("lease runtime requires an allowed manifest")
        self.chain = chain
        self.spec = spec
        self.price = price_per_interval
        self.interval = interval_secs
        self.min_intervals = min_intervals
        self.max_intervals = max_intervals
        self.stake_amount = stake_amount
        self.capabilities = capabilities
        self.allowed_manifest = allowed_manifest
        self.lease_executor = lease_executor
        self.lease_workload = lease_workload
        self.auto_faucet = auto_faucet
        self.ssh_secret = ssh_secret
        self.ssh_host = ssh_host

    def ensure_ready(self) -> None:
        """Register and stake enough to be eligible."""
        self.chain.ensure_provider_ready(
            self.capabilities,
            self.stake_amount,
            auto_faucet=self.auto_faucet,
        )

    def create_listing(self) -> int:
        listing_id = self.chain.call(self.chain.rental.functions.nextListingId())
        self.chain.tx(
            self.chain.rental.functions.createListing(
                self.price, self.interval, self.min_intervals, self.max_intervals, self.spec
            )
        )
        return int(listing_id)

    def ensure_listing(self) -> tuple[int, bool]:
        """Keep one active listing for this provider and current configuration."""
        rental = self.chain.rental
        active: list[tuple[int, tuple]] = []
        next_id = int(self.chain.call(rental.functions.nextListingId()))
        for listing_id in range(1, next_id):
            listing = self.chain.call(rental.functions.getListing(listing_id))
            if (
                listing[0].lower() == self.chain.address.lower()
                and (listing[LISTING_AVAILABLE] or int(listing[LISTING_ACTIVE_LEASE]) != 0)
            ):
                active.append((listing_id, listing))

        reserved = [item for item in active if int(item[1][LISTING_ACTIVE_LEASE]) != 0]
        expected = (self.price, self.interval, self.min_intervals, self.max_intervals, self.spec)
        matching = [
            item
            for item in active
            if (
                int(item[1][1]),
                int(item[1][2]),
                int(item[1][3]),
                int(item[1][4]),
                item[1][7],
            )
            == expected
        ]
        keep = (reserved or matching or [None])[0]
        for listing_id, listing in active:
            if keep is not None and listing_id == keep[0]:
                continue
            if listing[LISTING_AVAILABLE] and int(listing[LISTING_ACTIVE_LEASE]) == 0:
                self.chain.tx(rental.functions.setListingAvailable(listing_id, False))

        if keep is not None:
            return keep[0], False
        return self.create_listing(), True

    def active_leases(self) -> Iterator[int]:
        rental = self.chain.rental
        next_id = self.chain.call(rental.functions.nextLeaseId())
        for lease_id in range(1, next_id):
            lease = self.chain.call(rental.functions.getLease(lease_id))
            # Lease tuple ends with status and the requester-supplied manifest.
            if lease[LEASE_PROVIDER] == self.chain.address and lease[LEASE_STATUS] == LEASE_ACTIVE:
                yield lease_id

    def pending_requests(self) -> Iterator[int]:
        """Yield pending request IDs assigned to this provider."""
        rental = self.chain.rental
        next_id = self.chain.call(rental.functions.nextLeaseId())
        for lease_id in range(1, next_id):
            lease = self.chain.call(rental.functions.getLease(lease_id))
            if lease[LEASE_PROVIDER] == self.chain.address and lease[LEASE_STATUS] == LEASE_PENDING:
                yield lease_id

    def accept_request(self, lease_id: int) -> None:
        """Accept a pending request only when it matches the provider allowlist."""
        lease = self.chain.call(self.chain.rental.functions.getLease(lease_id))
        if lease[LEASE_PROVIDER] != self.chain.address or lease[LEASE_STATUS] != LEASE_PENDING:
            raise ValueError(f"lease {lease_id} is not a pending request for this provider")
        if self.allowed_manifest is None or lease[LEASE_MANIFEST] != self.allowed_manifest:
            raise ValueError(f"lease {lease_id} manifest is not allowed")
        self.chain.tx(self.chain.rental.functions.acceptLease(lease_id))

    def reject_request(self, lease_id: int) -> None:
        """Reject a pending request and trigger its on-chain escrow refund."""
        lease = self.chain.call(self.chain.rental.functions.getLease(lease_id))
        if lease[LEASE_PROVIDER] != self.chain.address or lease[LEASE_STATUS] != LEASE_PENDING:
            raise ValueError(f"lease {lease_id} is not a pending request for this provider")
        self.chain.tx(self.chain.rental.functions.rejectLease(lease_id))

    def process_pending_requests(self) -> tuple[int, int]:
        """Accept allowlisted requests and explicitly reject every other request."""
        accepted = 0
        rejected = 0
        rental = self.chain.rental
        for lease_id in list(self.pending_requests()):
            lease = self.chain.call(rental.functions.getLease(lease_id))
            listing = self.chain.call(
                rental.functions.getListing(lease[LEASE_LISTING])
            )
            can_accept = (
                self.allowed_manifest is not None
                and lease[LEASE_MANIFEST] == self.allowed_manifest
                and listing[LISTING_AVAILABLE]
                and int(listing[LISTING_ACTIVE_LEASE]) == 0
            )
            if can_accept:
                self.accept_request(lease_id)
                accepted += 1
            else:
                self.reject_request(lease_id)
                rejected += 1
        return accepted, rejected

    def heartbeat_due(self, lease_id: int) -> bool:
        """Return whether the current interval needs its first heartbeat."""
        lease = self.chain.call(self.chain.rental.functions.getLease(lease_id))
        if lease[LEASE_STATUS] != LEASE_ACTIVE or lease[LEASE_MANIFEST] != self.allowed_manifest:
            return False
        now = int(
            self.chain.rpc(lambda: self.chain.w3.eth.get_block("latest"))["timestamp"]
        )
        current = (now - int(lease[LEASE_START])) // int(lease[LEASE_INTERVAL_SECS])
        return (
            current < int(lease[LEASE_FUNDED_INTERVALS])
            and current == int(lease[LEASE_HEARTBEATED_INTERVALS])
        )

    def heartbeat_all(self) -> int:
        count = 0
        for lease_id in self.serving_leases():
            if self.heartbeat_due(lease_id):
                self.chain.tx(self.chain.rental.functions.heartbeat(lease_id))
                count += 1
        return count

    def serving_leases(self) -> Iterator[int]:
        """Yield active leases whose funded runtime has not elapsed."""
        rental = self.chain.rental
        now = int(
            self.chain.rpc(lambda: self.chain.w3.eth.get_block("latest"))["timestamp"]
        )
        for lease_id in self.active_leases():
            lease = self.chain.call(rental.functions.getLease(lease_id))
            end = int(lease[LEASE_START]) + int(lease[LEASE_INTERVAL_SECS]) * int(
                lease[LEASE_FUNDED_INTERVALS]
            )
            if lease[LEASE_MANIFEST] == self.allowed_manifest and now < end:
                yield lease_id

    def lease_credentials(self, lease_id: int) -> dict | None:
        """Connection details for an interactive lease, or None when not applicable.

        The password is derived from a provider-held secret and the lease id, so it
        is stable across agent restarts without storing per-lease state, and it
        cannot be guessed from public chain data.
        """
        workload = self.lease_workload
        executor = self.lease_executor
        if workload is None or executor is None or not workload.interactive:
            return None
        if not self.ssh_secret:
            return None

        password = hmac.new(
            self.ssh_secret.encode(),
            f"shadermesh-lease-ssh:{lease_id}".encode(),
            hashlib.sha256,
        ).hexdigest()[:24]
        return {
            "leaseId": lease_id,
            "protocol": "ssh",
            "host": self.ssh_host,
            "port": executor.ssh_port(lease_id),
            "username": "root",
            "password": password,
        }

    def _lease_workload_for(self, lease_id: int) -> LeaseWorkload:
        """Bind per-lease credentials into the provider's configured workload."""
        workload = self.lease_workload
        assert workload is not None
        credentials = self.lease_credentials(lease_id)
        if credentials is None:
            return workload
        return replace(
            workload,
            environment={
                **dict(workload.environment),
                "LEASE_ID": str(lease_id),
                "LEASE_SSH_PASSWORD": credentials["password"],
            },
        )

    def reconcile_workloads(self) -> int:
        """Match lease containers to chain state and heartbeat only healthy ones."""
        if self.lease_executor is None or self.lease_workload is None:
            return self.heartbeat_all()

        serving = set(self.serving_leases())
        for lease_id in self.lease_executor.managed_lease_ids() - serving:
            try:
                self.lease_executor.stop(lease_id)
                print(f"[rental] stopped workload for inactive lease #{lease_id}")
            except Exception as exc:
                print(f"[rental] workload stop error for lease #{lease_id}: {exc}")

        count = 0
        for lease_id in sorted(serving):
            try:
                self.lease_executor.ensure_started(lease_id, self._lease_workload_for(lease_id))
                if not self.lease_executor.is_healthy(lease_id):
                    print(f"[rental] workload for lease #{lease_id} is not healthy")
                    continue
                if self.heartbeat_due(lease_id):
                    self.chain.tx(self.chain.rental.functions.heartbeat(lease_id))
                    count += 1
            except Exception as exc:
                print(f"[rental] workload error for lease #{lease_id}: {exc}")
        return count

    def serve_forever(
        self,
        poll_secs: float = 30.0,
        maintenance: Callable[[], None] | None = None,
    ) -> None:
        while True:
            if maintenance is not None:
                try:
                    maintenance()
                except Exception as exc:
                    print(f"[rental] provider maintenance error: {exc}")
            try:
                accepted, rejected = self.process_pending_requests()
                if accepted or rejected:
                    print(f"[rental] requests accepted={accepted} rejected={rejected}")
                n = self.reconcile_workloads()
                if n:
                    print(f"[rental] heartbeat sent for {n} active lease(s)")
            except Exception as exc:  # keep serving through transient errors
                print(f"[rental] heartbeat error: {exc}")
            time.sleep(poll_secs)


class RentalRenter:
    def __init__(self, chain: ChainClient):
        self.chain = chain

    def request_lease(self, listing_id: int, intervals: int, manifest: str) -> int:
        if not is_content_addressed_manifest(manifest):
            raise ValueError("lease manifest must be an IPFS content-addressed URI")
        rental = self.chain.rental
        listing = self.chain.call(rental.functions.getListing(listing_id))
        price = listing[1]
        escrow = price * intervals
        self.chain.tx(self.chain.token.functions.approve(rental.address, escrow))
        lease_id = self.chain.call(rental.functions.nextLeaseId())
        self.chain.tx(rental.functions.requestLease(listing_id, intervals, manifest))
        return int(lease_id)

    def settle(self, lease_id: int) -> None:
        self.chain.tx(self.chain.rental.functions.settle(lease_id))

    def end_lease(self, lease_id: int) -> None:
        self.chain.tx(self.chain.rental.functions.endLease(lease_id))

    def terminate(self, lease_id: int) -> None:
        self.chain.tx(self.chain.rental.functions.terminate(lease_id))
