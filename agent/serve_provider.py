#!/usr/bin/env python3
"""
ShaderMesh provider node entrypoint (rental serving + inference).

A provider runs this to:
  1. register and stake (if not already),
  2. create a rental listing (if it has none active),
  3. serve an OpenAI-compatible inference endpoint for its advertised models,
  4. keep every active lease alive by sending heartbeats.

Attestation is performed by the registry attester (an operator or attestation
service) out of band; a provider cannot attest itself.

Config via environment (see .env.example):
  RPC_URL, DEPLOYMENTS_FILE, PROVIDER_PRIVATE_KEY,
  RENTAL_PRICE_USD, RENTAL_INTERVAL_SECS, RENTAL_MIN, RENTAL_MAX, RENTAL_SPEC,
  STAKE_AMOUNT_USD, INFERENCE_PORT, INFERENCE_BACKEND, MODELS, POLL_SECS
"""

from __future__ import annotations

import json
import os
import threading

# 1 SMESH is pegged to 1 USD for the demo, so USD maps 1:1 to token base units.
USD = 10**18


def _env_usd(name: str, default: float) -> int:
    return int(float(os.environ.get(name, str(default))) * USD)


def main() -> None:
    from chain import ChainClient, load_deployment
    from rental import RentalProvider
    from inference import run_server, make_backend

    rpc = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
    deployments_file = os.environ.get("DEPLOYMENTS_FILE", "../contracts/deployments/docker.json")
    key = os.environ.get("PROVIDER_PRIVATE_KEY", "")
    if not key:
        print("[provider] no PROVIDER_PRIVATE_KEY set; nothing to do.")
        return

    chain = ChainClient(rpc, load_deployment(deployments_file), key)
    models = [m.strip() for m in os.environ.get("MODELS", "llama-3.1-8b,mistral-7b").split(",")]

    # Inference endpoint in a background thread.
    backend = make_backend(os.environ.get("INFERENCE_BACKEND", "echo"))
    port = int(os.environ.get("INFERENCE_PORT", "8100"))
    server = run_server("0.0.0.0", port, backend, models, chain.address)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"[provider] inference on :{port} models={models}")

    spec = os.environ.get(
        "RENTAL_SPEC",
        json.dumps({"gpu": "cpu-demo", "vram": 0, "region": "local", "models": models}),
    )
    provider = RentalProvider(
        chain,
        spec=spec,
        price_per_interval=_env_usd("RENTAL_PRICE_USD", 0.42),
        interval_secs=int(os.environ.get("RENTAL_INTERVAL_SECS", "600")),
        min_intervals=int(os.environ.get("RENTAL_MIN", "1")),
        max_intervals=int(os.environ.get("RENTAL_MAX", "168")),
        stake_amount=_env_usd("STAKE_AMOUNT_USD", 100),
    )
    provider.ensure_ready()
    print(f"[provider] ready {chain.address}")

    if not _has_active_listing(chain):
        if chain.registry.functions.isAttested(chain.address).call():
            listing_id = provider.create_listing()
            print(f"[provider] created listing #{listing_id}")
        else:
            print("[provider] not attested yet; waiting for attestation before listing")

    provider.serve_forever(poll_secs=float(os.environ.get("POLL_SECS", "30")))


def _has_active_listing(chain) -> bool:
    rental = chain.rental
    next_id = rental.functions.nextListingId().call()
    for listing_id in range(1, next_id):
        listing = rental.functions.getListing(listing_id).call()
        # Listing tuple: [provider, price, interval, min, max, active, spec]
        if listing[0] == chain.address and listing[5]:
            return True
    return False


if __name__ == "__main__":
    main()
