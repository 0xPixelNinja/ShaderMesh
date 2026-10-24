#!/usr/bin/env python3
"""Prepare the local chain so the dashboard has real, working state.

This deliberately creates no synthetic listings. Every listing the dashboard
shows is published by a provider agent that is actually running, so any listing
on screen can genuinely accept a lease. The script only:

  1. funds, registers, stakes, and attests the live agent account, leaving the
     listing itself to serve_provider.py,
  2. optionally funds a browser wallet so a demo can start immediately,
  3. enables interval mining, because Hardhat only mines on a transaction and a
     frozen clock stalls lease intervals and heartbeats.

Run against a local Hardhat node after deploy:

    RPC_URL=http://127.0.0.1:8545 \
    DEPLOYMENTS_FILE=../contracts/deployments/localhost.json \
    python seed_demo.py
"""

from __future__ import annotations

import os

from web3 import Web3

from chain import ChainClient, load_deployment
from rental import RentalProvider, attest_provider

RPC = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
DEP = os.environ.get("DEPLOYMENTS_FILE", "../contracts/deployments/localhost.json")

# The live provider agent (serve_provider.py) runs on this account. It is funded,
# registered, staked, and attested here; it publishes its own listing from
# RENTAL_SPEC so the listing always matches a provider that is really serving.
LIVE_PROVIDER_INDEX = int(os.environ.get("DEMO_LIVE_PROVIDER_INDEX", "1"))
LIVE_PROVIDER_GPU = os.environ.get("DEMO_LIVE_PROVIDER_GPU", "RTX 4070 Laptop GPU")
LIVE_PROVIDER_VRAM = int(os.environ.get("DEMO_LIVE_PROVIDER_VRAM", "8"))
LIVE_PROVIDER_CAPABILITIES = os.environ.get(
    "CAPABILITIES",
    '{"gpu":"NVIDIA GeForce RTX 4070 Laptop GPU","vram":8,"cpu":"host","region":"local"}',
)
# Low on purpose: the attester requires a challenge score of at least half of this
# (CHALLENGE_MIN_SCORE_BPS). The score unit depends on the backend (hash kH/s for
# echo, tokens/sec x 100 for Ollama), so a low value passes reliably on either.
# Use `python benchmark.py` on real hardware to pick a realistic value.
LIVE_PROVIDER_BENCHMARK = int(os.environ.get("DEMO_LIVE_PROVIDER_BENCHMARK", "100"))
LIVE_PROVIDER_STAKE = float(os.environ.get("DEMO_PROVIDER_STAKE_SMESH", "100"))
LIVE_PROVIDER_FUNDING = float(os.environ.get("DEMO_PROVIDER_FUNDING_SMESH", "500"))

# Optional browser-wallet address to fund, so a browser account can drive the
# demo immediately after the chain is reset. Local devnet only.
FUND_ADDRESS = os.environ.get("DEMO_FUND_ADDRESS", "").strip()
FUND_ETH = float(os.environ.get("DEMO_FUND_ETH", "100"))
FUND_SMESH = float(os.environ.get("DEMO_FUND_SMESH", "5000"))

# Unlocked requester account used by the smoke scripts and CI. It already holds
# test ETH from Hardhat but needs SMESH to open escrow and prepaid credits.
REQUESTER_INDEX = int(os.environ.get("SMOKE_ACCOUNT_INDEX", "4"))
REQUESTER_SMESH = float(os.environ.get("DEMO_REQUESTER_SMESH", "1000"))

# Block cadence for the local demo chain, so chain time tracks the wall clock.
MINING_INTERVAL_MS = int(os.environ.get("DEMO_MINING_INTERVAL_MS", "1000"))


def wei(n: float) -> int:
    return Web3.to_wei(n, "ether")


def main() -> None:
    dep = load_deployment(DEP)
    owner = ChainClient.from_unlocked_account(RPC, dep, 0)

    live = RentalProvider(
        ChainClient.from_unlocked_account(RPC, dep, LIVE_PROVIDER_INDEX),
        spec="{}",
        price_per_interval=wei(0.02),
        interval_secs=60,
        stake_amount=wei(LIVE_PROVIDER_STAKE),
        capabilities=LIVE_PROVIDER_CAPABILITIES,
    )
    owner.tx(owner.token.functions.transfer(live.chain.address, wei(LIVE_PROVIDER_FUNDING)))
    live.ensure_ready()
    attest_provider(
        owner, live.chain.address, LIVE_PROVIDER_GPU, LIVE_PROVIDER_VRAM, LIVE_PROVIDER_BENCHMARK
    )
    print(f"prepared live provider {live.chain.address} as {LIVE_PROVIDER_GPU}")

    requester = ChainClient.from_unlocked_account(RPC, dep, REQUESTER_INDEX)
    owner.tx(owner.token.functions.transfer(requester.address, wei(REQUESTER_SMESH)))
    print(f"funded requester account {requester.address} with {REQUESTER_SMESH} SMESH")

    if FUND_ADDRESS:
        target = Web3.to_checksum_address(FUND_ADDRESS)
        receipt = owner.w3.eth.send_transaction(
            {"from": owner.address, "to": target, "value": wei(FUND_ETH)}
        )
        owner.w3.eth.wait_for_transaction_receipt(receipt)
        owner.tx(owner.token.functions.transfer(target, wei(FUND_SMESH)))
        print(f"funded browser wallet {target} with {FUND_ETH} ETH and {FUND_SMESH} SMESH")

    owner.w3.provider.make_request("evm_setIntervalMining", [int(MINING_INTERVAL_MS)])
    print(f"enabled interval mining every {MINING_INTERVAL_MS}ms")
    print("seed complete; the provider agent publishes its own listing")


if __name__ == "__main__":
    main()
