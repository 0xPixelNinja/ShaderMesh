#!/usr/bin/env python3
"""Seed the local chain with real listings and a lease for the dashboard demo.

Creates a few attested providers with listings and requests one active lease with
a few settled intervals, so the orchestrator indexes real data the UI reads.
Run against a local Hardhat node after deploy:

    RPC_URL=http://127.0.0.1:8545 \
    DEPLOYMENTS_FILE=../contracts/deployments/localhost.json \
    python seed_demo.py
"""

from __future__ import annotations

import os

from web3 import Web3

from chain import ChainClient, load_deployment
from rental import RentalProvider, RentalRenter, attest_provider

RPC = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
DEP = os.environ.get("DEPLOYMENTS_FILE", "../contracts/deployments/localhost.json")

# The provider that serves inference; the gateway routes here for the demo.
ENDPOINT = os.environ.get("INFERENCE_ENDPOINT", "http://127.0.0.1:8100")
MANIFEST = os.environ.get(
    "DEMO_LEASE_MANIFEST",
    "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3ayu5ol5qi2ngv3a6h4q",
)

SPECS = [
    (1, f'{{"gpu":"RTX 4090","vram":24,"region":"us-east","models":["llama-3.1-8b"],"endpoint":"{ENDPOINT}"}}', 0.42, "RTX 4090", 24),
    (2, '{"gpu":"A100 80GB","vram":80,"region":"eu-west","models":["qwen2.5-14b"]}', 0.95, "A100 80GB", 80),
    (3, '{"gpu":"RTX 3090","vram":24,"region":"ap-south","models":["mistral-7b"]}', 0.30, "RTX 3090", 24),
]
INTERVAL = 600
LEASE_INTERVALS = int(os.environ.get("DEMO_LEASE_INTERVALS", "144"))


def wei(n: float) -> int:
    return Web3.to_wei(n, "ether")


def main() -> None:
    dep = load_deployment(DEP)
    owner = ChainClient.from_unlocked_account(RPC, dep, 0)

    listings = []
    for key_idx, spec, price_usd, gpu, vram in SPECS:
        p = RentalProvider(
            ChainClient.from_unlocked_account(RPC, dep, key_idx), spec=spec,
            price_per_interval=wei(price_usd), interval_secs=INTERVAL,
            min_intervals=1, max_intervals=168, stake_amount=wei(100),
            allowed_manifest=MANIFEST,
        )
        owner.tx(owner.token.functions.transfer(p.chain.address, wei(200)))
        p.ensure_ready()
        attest_provider(owner, p.chain.address, gpu, vram, 1000)
        listing_id = p.create_listing()
        listings.append((p, listing_id))
        print(f"listed {gpu} as listing #{listing_id}")

    renter = RentalRenter(ChainClient.from_unlocked_account(RPC, dep, 4))
    owner.tx(owner.token.functions.transfer(renter.chain.address, wei(1000)))
    provider0, listing0 = listings[0]
    lease_id = renter.request_lease(listing0, LEASE_INTERVALS, MANIFEST)
    accepted, rejected = provider0.process_pending_requests()
    if (accepted, rejected) != (1, 0):
        raise RuntimeError(f"unexpected request decision: accepted={accepted} rejected={rejected}")
    if provider0.heartbeat_all() != 1:
        raise RuntimeError("initial lease heartbeat was not sent")
    print(f"requested and accepted lease #{lease_id}")

    # Advance a few intervals with heartbeats and settle, so the lease shows spend.
    for _ in range(3):
        provider0.chain.w3.provider.make_request("evm_increaseTime", [INTERVAL])
        provider0.chain.w3.provider.make_request("evm_mine", [])
        if provider0.heartbeat_all() != 1:
            raise RuntimeError("elapsed lease interval was not heartbeated")
    renter.settle(lease_id)
    print("settled 3 intervals on lease #%d" % lease_id)
    print("seed complete")


if __name__ == "__main__":
    main()
