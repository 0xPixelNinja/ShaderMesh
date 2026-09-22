#!/usr/bin/env python3
"""Seed the local chain with real listings and a lease for the dashboard demo.

Prepares the live agent account (fund, register, stake, attest) without listing
for it, then creates background marketplace inventory from other attested
providers and puts one of those under an active lease with settled intervals, so
the orchestrator indexes real data the UI reads.
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

MANIFEST = os.environ.get(
    "DEMO_LEASE_MANIFEST",
    "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3ayu5ol5qi2ngv3a6h4q",
)

# The live provider agent (serve_provider.py) runs on this account. Seed funds,
# registers, and attests it, but deliberately creates NO listing for it: the agent
# creates and owns its own listing so it stays available to rent during the demo.
LIVE_PROVIDER_INDEX = int(os.environ.get("DEMO_LIVE_PROVIDER_INDEX", "1"))
LIVE_PROVIDER_GPU = os.environ.get("DEMO_LIVE_PROVIDER_GPU", "RTX 4070 Laptop GPU")
LIVE_PROVIDER_VRAM = int(os.environ.get("DEMO_LIVE_PROVIDER_VRAM", "8"))
LIVE_PROVIDER_CAPABILITIES = os.environ.get(
    "CAPABILITIES",
    '{"gpu":"NVIDIA GeForce RTX 4070 Laptop GPU","vram":8,"cpu":"host","region":"local"}',
)

# Background marketplace inventory: raw GPU capacity from other staked providers.
# These accounts run no agent, so they are never used as a live lease target.
SPECS = [
    (2, '{"gpu":"A100 80GB","vram":80,"region":"eu-west"}', 0.95, "A100 80GB", 80),
    (3, '{"gpu":"RTX 3090","vram":24,"region":"ap-south"}', 0.30, "RTX 3090", 24),
    (5, '{"gpu":"RTX 4080","vram":16,"region":"us-west"}', 0.55, "RTX 4080", 16),
]
INTERVAL = 600
LEASE_INTERVALS = int(os.environ.get("DEMO_LEASE_INTERVALS", "144"))
# Block cadence for the local demo chain, so chain time tracks the wall clock.
MINING_INTERVAL_MS = int(os.environ.get("DEMO_MINING_INTERVAL_MS", "1000"))

# Optional browser-wallet address to fund, so a browser account can drive the
# demo immediately after the chain is reset. Local devnet only.
FUND_ADDRESS = os.environ.get("DEMO_FUND_ADDRESS", "").strip()
FUND_ETH = float(os.environ.get("DEMO_FUND_ETH", "100"))
FUND_SMESH = float(os.environ.get("DEMO_FUND_SMESH", "5000"))


def wei(n: float) -> int:
    return Web3.to_wei(n, "ether")


def main() -> None:
    dep = load_deployment(DEP)
    owner = ChainClient.from_unlocked_account(RPC, dep, 0)

    # Fund, register, stake, and attest the live agent account. No listing is
    # created here: serve_provider.py creates its own from RENTAL_SPEC and keeps
    # it available, which is what the live "rent a GPU" demo leases.
    live = RentalProvider(
        ChainClient.from_unlocked_account(RPC, dep, LIVE_PROVIDER_INDEX),
        spec="{}",
        price_per_interval=wei(0.42),
        interval_secs=INTERVAL,
        stake_amount=wei(100),
        capabilities=LIVE_PROVIDER_CAPABILITIES,
    )
    owner.tx(owner.token.functions.transfer(live.chain.address, wei(500)))
    live.ensure_ready()
    attest_provider(owner, live.chain.address, LIVE_PROVIDER_GPU, LIVE_PROVIDER_VRAM, 1000)
    print(f"prepared live provider {live.chain.address} as {LIVE_PROVIDER_GPU}")

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

    if FUND_ADDRESS:
        target = Web3.to_checksum_address(FUND_ADDRESS)
        receipt = owner.w3.eth.send_transaction(
            {"from": owner.address, "to": target, "value": wei(FUND_ETH)}
        )
        owner.w3.eth.wait_for_transaction_receipt(receipt)
        owner.tx(owner.token.functions.transfer(target, wei(FUND_SMESH)))
        print(f"funded browser wallet {target} with {FUND_ETH} ETH and {FUND_SMESH} SMESH")

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

    # Hardhat only mines when a transaction arrives, which freezes block.timestamp
    # between transactions. Lease intervals and heartbeats are driven by chain time,
    # so without this the demo lease never advances an interval on its own. Interval
    # mining makes the local chain track the wall clock like a real network.
    owner.w3.provider.make_request("evm_setIntervalMining", [int(MINING_INTERVAL_MS)])
    print(f"enabled interval mining every {MINING_INTERVAL_MS}ms")
    print("seed complete")


if __name__ == "__main__":
    main()
