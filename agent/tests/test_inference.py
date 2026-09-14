"""Tests for the OpenAI-compatible inference endpoint (echo backend)."""

from __future__ import annotations

import json
import threading
import urllib.request

from inference import run_server, EchoBackend


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
