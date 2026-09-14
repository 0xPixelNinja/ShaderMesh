#!/usr/bin/env python3
"""Seed the local chain with real listings and a lease for the dashboard demo.

Creates a few attested providers with listings and opens one active lease with a
couple of settled intervals, so the orchestrator indexes real data the UI reads.
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

KEYS = {
    0: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    3: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    4: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
}

SPECS = [
    (1, '{"gpu":"RTX 4090","vram":24,"region":"us-east","models":["llama-3.1-8b"],"endpoint":"http://127.0.0.1:8100"}', 0.42, "RTX 4090", 24),
    (2, '{"gpu":"A100 80GB","vram":80,"region":"eu-west","models":["qwen2.5-14b"]}', 0.95, "A100 80GB", 80),
    (3, '{"gpu":"RTX 3090","vram":24,"region":"ap-south","models":["mistral-7b"]}', 0.30, "RTX 3090", 24),
]
INTERVAL = 600


def wei(n: float) -> int:
    return Web3.to_wei(n, "ether")


def main() -> None:
    dep = load_deployment(DEP)
    owner = ChainClient(RPC, dep, KEYS[0])

    listings = []
    for key_idx, spec, price_usd, gpu, vram in SPECS:
        p = RentalProvider(
            ChainClient(RPC, dep, KEYS[key_idx]), spec=spec,
            price_per_interval=wei(price_usd), interval_secs=INTERVAL,
            min_intervals=1, max_intervals=168, stake_amount=wei(100),
        )
        owner.tx(owner.token.functions.transfer(p.chain.address, wei(200)))
        p.ensure_ready()
        attest_provider(owner, p.chain.address, gpu, vram, 1000)
        listing_id = p.create_listing()
        listings.append((p, listing_id))
        print(f"listed {gpu} as listing #{listing_id}")

    renter = RentalRenter(ChainClient(RPC, dep, KEYS[4]))
    owner.tx(owner.token.functions.transfer(renter.chain.address, wei(1000)))
    provider0, listing0 = listings[0]
    lease_id = renter.open_lease(listing0, 24)
    provider0.chain.tx(provider0.chain.rental.functions.heartbeat(lease_id))
    print(f"opened lease #{lease_id}")

    # Advance a few intervals with heartbeats and settle, so the lease shows spend.
    provider0.chain.w3.provider.make_request("evm_increaseTime", [INTERVAL * 3])
    provider0.chain.w3.provider.make_request("evm_mine", [])
    provider0.chain.tx(provider0.chain.rental.functions.heartbeat(lease_id))
    renter.settle(lease_id)
    print("settled 3 intervals on lease #%d" % lease_id)
    print("seed complete")


if __name__ == "__main__":
    main()
