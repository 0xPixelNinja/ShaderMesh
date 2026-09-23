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
  STAKE_AMOUNT_USD, INFERENCE_PORT, INFERENCE_BACKEND,
  INFERENCE_PRICE_SMESH_PER_1K_TOKENS, MODELS, POLL_SECS,
  LEASE_ALLOWED_MANIFEST, LEASE_WORKLOAD_IMAGE and LEASE_* sandbox settings
"""

from __future__ import annotations

import json
import os
import threading
from decimal import Decimal, InvalidOperation

# 1 SMESH is pegged to 1 USD for the demo, so USD maps 1:1 to token base units.
USD = 10**18


def _env_usd(name: str, default: float) -> int:
    return int(float(os.environ.get(name, str(default))) * USD)


def _inference_price_per_token(raw_price: str) -> int:
    """Convert SMESH per 1K tokens to exact base units per token."""
    try:
        price_per_1k = Decimal(raw_price)
    except InvalidOperation as exc:
        raise ValueError(
            "INFERENCE_PRICE_SMESH_PER_1K_TOKENS must be a decimal number"
        ) from exc
    if not price_per_1k.is_finite() or price_per_1k <= 0:
        raise ValueError("INFERENCE_PRICE_SMESH_PER_1K_TOKENS must be positive")

    price_per_token = price_per_1k * USD / 1000
    if price_per_token != price_per_token.to_integral_value():
        raise ValueError(
            "INFERENCE_PRICE_SMESH_PER_1K_TOKENS must resolve to whole "
            "SMESH base units per token"
        )
    return int(price_per_token)


def _env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in ("1", "true", "yes")


def _lease_runtime(provider_address: str):
    image = os.environ.get("LEASE_WORKLOAD_IMAGE", "").strip()
    if not image:
        return None, None

    from executor import DockerLeaseExecutor, LeaseWorkload

    command = json.loads(os.environ.get("LEASE_WORKLOAD_COMMAND", "[]"))
    environment = json.loads(os.environ.get("LEASE_WORKLOAD_ENV", "{}"))
    if not isinstance(command, list) or not all(isinstance(arg, str) for arg in command):
        raise ValueError("LEASE_WORKLOAD_COMMAND must be a JSON string array")
    if not isinstance(environment, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in environment.items()
    ):
        raise ValueError("LEASE_WORKLOAD_ENV must be a JSON string object")

    interactive = _env_bool("LEASE_WORKLOAD_INTERACTIVE")
    workload = LeaseWorkload(
        image=image,
        command=tuple(command),
        environment=environment,
        gpu=_env_bool("LEASE_WORKLOAD_GPU"),
        interactive=interactive,
    )
    executor = DockerLeaseExecutor(
        provider_address,
        mem_limit=os.environ.get("LEASE_MEMORY_LIMIT", "4g"),
        cpu_count=float(os.environ.get("LEASE_CPU_COUNT", "1")),
        pids_limit=int(os.environ.get("LEASE_PIDS_LIMIT", "256")),
        user=os.environ.get("LEASE_CONTAINER_USER", "65532:65532"),
        tmpfs_size=os.environ.get("LEASE_TMPFS_SIZE", "64m"),
        gpu_enabled=_env_bool("LEASE_GPU_ENABLED"),
        gpu_device_ids=tuple(
            item.strip()
            for item in os.environ.get("LEASE_GPU_DEVICE_IDS", "").split(",")
            if item.strip()
        ),
        allow_mutable_images=_env_bool("LEASE_ALLOW_MUTABLE_IMAGE"),
        interactive_enabled=interactive,
        interactive_port_base=int(os.environ.get("LEASE_SSH_PORT_BASE", "2200")),
    )
    workload.validate(allow_mutable_image=executor.allow_mutable_images)
    return executor, workload


def ensure_inference_offers(
    chain, models: list[str], price_per_token: int
) -> tuple[list[int], list[int]]:
    """Keep exactly one active, correctly priced offer for each model."""
    if chain.inference is None:
        return [], []
    if price_per_token <= 0:
        raise ValueError("inference price per token must be positive")
    if not chain.call(chain.registry.functions.isEligible(chain.address)):
        return [], []
    if not chain.call(chain.registry.functions.isAttested(chain.address)):
        return [], []

    offers_by_model: dict[str, list[tuple[int, int]]] = {}
    next_offer_id = int(chain.call(chain.inference.functions.nextOfferId()))
    for offer_id in range(1, next_offer_id):
        offer = chain.call(chain.inference.functions.getOffer(offer_id))
        if offer[0].lower() == chain.address.lower() and offer[2]:
            offers_by_model.setdefault(offer[3], []).append((offer_id, int(offer[1])))

    created: list[int] = []
    deactivated: list[int] = []
    configured_models = set(models)
    for model, active in offers_by_model.items():
        if model not in configured_models:
            for offer_id, _ in active:
                chain.tx(chain.inference.functions.deactivateOffer(offer_id))
                deactivated.append(offer_id)

    for model in dict.fromkeys(models):
        active = offers_by_model.get(model, [])
        matching = [offer_id for offer_id, price in active if price == price_per_token]
        keep = matching[0] if matching else None
        for offer_id, _ in active:
            if offer_id != keep:
                chain.tx(chain.inference.functions.deactivateOffer(offer_id))
                deactivated.append(offer_id)
        if keep is None:
            offer_id = int(chain.call(chain.inference.functions.nextOfferId()))
            chain.tx(chain.inference.functions.createOffer(model, price_per_token))
            created.append(offer_id)
    return created, deactivated


def maintain_advertisements(
    provider, models: list[str], price_per_token: int
) -> None:
    """Reconcile readiness, one rental listing, and configured inference offers."""
    provider.ensure_ready()
    chain = provider.chain
    if not chain.call(chain.registry.functions.isAttested(chain.address)):
        return

    listing_id, listing_created = provider.ensure_listing()
    if listing_created:
        print(f"[provider] created listing #{listing_id}")
    created, deactivated = ensure_inference_offers(chain, models, price_per_token)
    if created or deactivated:
        print(
            "[provider] inference offers "
            f"created={created} deactivated={deactivated}"
        )


def main() -> None:
    from chain import ChainClient, load_deployment
    from rental import RentalProvider
    from inference import run_server, make_backend
    from retry import RetryPolicy

    rpc = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
    deployments_file = os.environ.get("DEPLOYMENTS_FILE", "../contracts/deployments/docker.json")
    key = os.environ.get("PROVIDER_PRIVATE_KEY", "")
    if not key:
        print("[provider] no PROVIDER_PRIVATE_KEY set; nothing to do.")
        return

    chain = ChainClient(
        rpc,
        load_deployment(deployments_file),
        key,
        retry_policy=RetryPolicy.from_env(),
    )
    models = list(
        dict.fromkeys(
            m.strip()
            for m in os.environ.get("MODELS", "llama-3.1-8b,mistral-7b").split(",")
            if m.strip()
        )
    )
    if not models:
        raise ValueError("MODELS must contain at least one model identifier")
    inference_price = _inference_price_per_token(
        os.environ.get("INFERENCE_PRICE_SMESH_PER_1K_TOKENS", "0.002")
    )
    allowed_manifest = os.environ.get("LEASE_ALLOWED_MANIFEST", "").strip() or None
    lease_executor, lease_workload = _lease_runtime(chain.address)

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
        capabilities=os.environ.get("CAPABILITIES", '{"gpu":"generic"}'),
        allowed_manifest=allowed_manifest,
        lease_executor=lease_executor,
        lease_workload=lease_workload,
        auto_faucet=_env_bool("AUTO_FAUCET", True),
        ssh_secret=os.environ.get("LEASE_SSH_SECRET", ""),
        ssh_host=os.environ.get("LEASE_SSH_HOST", "localhost"),
    )

    def lease_access(lease_id: int):
        """Serve connection details only while the lease is actually being served."""
        if lease_id not in set(provider.serving_leases()):
            return None
        return provider.lease_credentials(lease_id)

    # Inference endpoint in a background thread. It also answers lease access
    # queries so a requester can reach the capacity they leased.
    backend = make_backend(os.environ.get("INFERENCE_BACKEND", "echo"))
    port = int(os.environ.get("INFERENCE_PORT", "8100"))
    server = run_server("0.0.0.0", port, backend, models, chain.address, lease_access)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"[provider] inference on :{port} models={models}")

    print(f"[provider] started {chain.address}; waiting for readiness and attestation")
    provider.serve_forever(
        poll_secs=float(os.environ.get("POLL_SECS", "30")),
        maintenance=lambda: maintain_advertisements(
            provider, models, inference_price
        ),
    )


if __name__ == "__main__":
    main()
