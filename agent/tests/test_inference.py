"""Tests for the OpenAI-compatible inference endpoint (echo backend)."""

from __future__ import annotations

import json
import threading
import urllib.request

import pytest

from chain import ChainClient
from inference import run_server, EchoBackend
from rental import RentalProvider, attest_provider
from serve_provider import (
    _inference_price_per_token,
    maintain_advertisements,
)
from conftest import RPC


def _get(url: str):
    return json.loads(urllib.request.urlopen(url, timeout=5).read())


def _post(url: str, body: dict):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST"
    )
    return json.loads(urllib.request.urlopen(req, timeout=5).read())


def test_openai_compatible_endpoint():
    server = run_server("127.0.0.1", 0, EchoBackend(), ["llama-3.1-8b"], "0xabc")
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{port}"

        health = _get(base + "/health")
        assert health["status"] == "ok"
        assert "llama-3.1-8b" in health["models"]

        models = _get(base + "/v1/models")
        assert models["data"][0]["id"] == "llama-3.1-8b"

        body = {
            "model": "llama-3.1-8b",
            "messages": [{"role": "user", "content": "hello there"}],
            "temperature": 0,
        }
        r1 = _post(base + "/v1/chat/completions", body)
        assert r1["object"] == "chat.completion"
        assert r1["choices"][0]["message"]["role"] == "assistant"
        assert r1["choices"][0]["message"]["content"]
        usage = r1["usage"]
        assert usage["completion_tokens"] > 0
        assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]

        # Deterministic at temperature 0 (supports the verification spot-check).
        r2 = _post(base + "/v1/chat/completions", body)
        assert r1["choices"][0]["message"]["content"] == r2["choices"][0]["message"]["content"]
    finally:
        server.shutdown()


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        ("0.002", 2_000_000_000_000),
        ("1", 1_000_000_000_000_000),
        ("0.000000000000001", 1),
    ],
)
def test_inference_price_converts_exactly(configured, expected):
    assert _inference_price_per_token(configured) == expected


@pytest.mark.parametrize("configured", ["0", "-1", "nan", "0.0000000000000001"])
def test_inference_price_rejects_non_positive_or_inexact_values(configured):
    with pytest.raises(ValueError):
        _inference_price_per_token(configured)


def test_inference_offer_creation_is_idempotent_on_restart(deployment):
    owner = ChainClient.from_unlocked_account(RPC, deployment, 0)
    chain = ChainClient.from_unlocked_account(RPC, deployment, 1)
    provider = RentalProvider(
        chain,
        spec='{"gpu":"RTX4090"}',
        price_per_interval=10**18,
        interval_secs=3600,
        stake_amount=100 * 10**18,
    )
    owner.tx(owner.token.functions.transfer(chain.address, 200 * 10**18))
    provider.ensure_ready()
    maintain_advertisements(provider, ["llama-3.1-8b"], 1)
    assert chain.rental.functions.nextListingId().call() == 1
    assert chain.inference.functions.nextOfferId().call() == 1
    attest_provider(owner, chain.address, "RTX4090", 24, 1000)

    models = ["llama-3.1-8b", "mistral-7b"]
    price = _inference_price_per_token("0.002")
    maintain_advertisements(provider, models, price)
    maintain_advertisements(provider, models, price)
    assert provider.ensure_listing() == (1, False)
    assert chain.rental.functions.nextListingId().call() == 2
    assert chain.inference.functions.nextOfferId().call() == 3

    offers = [chain.inference.functions.getOffer(offer_id).call() for offer_id in (1, 2)]
    assert {offer[3] for offer in offers} == set(models)
    assert all(offer[0] == chain.address for offer in offers)
    assert all(offer[1] == price and offer[2] for offer in offers)


def test_provider_claims_faucet_when_stake_balance_is_insufficient(deployment):
    chain = ChainClient.from_unlocked_account(RPC, deployment, 7)
    provider = RentalProvider(
        chain,
        spec='{"gpu":"CPU"}',
        price_per_interval=10**18,
        interval_secs=3600,
        stake_amount=100 * 10**18,
    )

    provider.ensure_ready()

    state = chain.registry.functions.providers(chain.address).call()
    assert state[0] is True
    assert state[2] == 100 * 10**18
    assert chain.token.functions.balanceOf(chain.address).call() == 900 * 10**18


def test_provider_readiness_reactivates_and_updates_capabilities(deployment):
    chain = ChainClient.from_unlocked_account(RPC, deployment, 7)
    original = RentalProvider(
        chain,
        spec='{"gpu":"CPU"}',
        price_per_interval=10**18,
        interval_secs=3600,
        stake_amount=100 * 10**18,
        capabilities='{"gpu":"old"}',
    )
    original.ensure_ready()
    chain.tx(chain.registry.functions.setActive(False))

    updated = RentalProvider(
        chain,
        spec='{"gpu":"CPU"}',
        price_per_interval=10**18,
        interval_secs=3600,
        stake_amount=100 * 10**18,
        capabilities='{"gpu":"new"}',
    )
    updated.ensure_ready()

    state = chain.registry.functions.providers(chain.address).call()
    assert state[1] is True
    assert state[7] == '{"gpu":"new"}'
