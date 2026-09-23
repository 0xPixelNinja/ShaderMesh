#!/usr/bin/env python3
"""
OpenAI-compatible inference endpoint for a ShaderMesh provider.

This serves the real API shape (POST /v1/chat/completions, GET /v1/models) with
real token metering, over the Python standard library so it has no dependencies.
The model backend is pluggable:

  - echo   : a deterministic demo model (no GPU, no deps). At temperature 0 it is
             reproducible, which supports the optional verification spot-check.
  - ollama : proxies to a local Ollama server (set OLLAMA_URL) for a real model.

The orchestrator gateway routes metered requests here; settlement is on chain.
"""

from __future__ import annotations

import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Protocol


def estimate_tokens(text: str) -> int:
    """Cheap, stable token estimate for metering (roughly 4 chars per token)."""
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


class Backend(Protocol):
    def generate(self, model: str, messages: list[dict], temperature: float, max_tokens: int) -> str: ...


class EchoBackend:
    """Deterministic demo model. Reproducible at temperature 0."""

    def generate(self, model: str, messages: list[dict], temperature: float, max_tokens: int) -> str:
        last = ""
        for m in messages:
            if m.get("role") == "user":
                last = m.get("content", "")
        reply = (
            f"[{model}] ShaderMesh managed inference. "
            f"You said {len(last)} characters. "
            "Rented compute is secured by staking, uptime heartbeats, attestation, "
            "and slashing; this response is metered per token and settled on chain."
        )
        # Respect a small max_tokens for the demo.
        limit = max_tokens * 4 if max_tokens else len(reply)
        return reply[:limit]


class OllamaBackend:
    """Proxy to a local Ollama server for a real model."""

    def __init__(self, url: str):
        self.url = url.rstrip("/")

    def generate(self, model: str, messages: list[dict], temperature: float, max_tokens: int) -> str:
        import requests  # lazy

        resp = requests.post(
            f"{self.url}/api/chat",
            json={"model": model, "messages": messages, "stream": False,
                  "options": {"temperature": temperature}},
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "")


def make_backend(name: str) -> Backend:
    if name == "ollama":
        return OllamaBackend(os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"))
    return EchoBackend()


def make_handler(
    backend: Backend,
    models: list[str],
    provider: str,
    lease_access=None,
):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # quiet
            pass

        def _json(self, status: int, body: dict):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("access-control-allow-origin", "*")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                return self._json(200, {"status": "ok", "provider": provider, "models": models})
            if self.path == "/v1/models":
                return self._json(200, {"object": "list", "data": [{"id": m, "object": "model"} for m in models]})

            # Connection details for an interactive lease.
            #
            # DEVNET SCOPE: this returns the lease credential to any caller that
            # can reach the provider, and the agent only checks that the lease is
            # active on chain. A public deployment must additionally require a
            # signature from the lease's requester, exactly as the inference
            # gateway already does for metered requests.
            match = re.fullmatch(r"/leases/(\d+)/access", self.path)
            if match:
                if lease_access is None:
                    return self._json(404, {"error": "interactive leases are not enabled"})
                try:
                    access = lease_access(int(match.group(1)))
                except Exception:
                    return self._json(502, {"error": "lease lookup failed"})
                if access is None:
                    return self._json(404, {"error": "no active interactive lease"})
                return self._json(200, access)

            return self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                return self._json(404, {"error": "not found"})
            length = int(self.headers.get("content-length", 0))
            try:
                req = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                return self._json(400, {"error": "invalid json"})

            model = req.get("model", models[0] if models else "echo")
            messages = req.get("messages", [])
            temperature = float(req.get("temperature", 0.7))
            max_tokens = int(req.get("max_tokens", 512))

            text = backend.generate(model, messages, temperature, max_tokens)
            prompt_tokens = sum(estimate_tokens(m.get("content", "")) for m in messages)
            completion_tokens = estimate_tokens(text)

            return self._json(200, {
                "id": f"chatcmpl-{int(time.time()*1000)}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "provider": provider,
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop",
                }],
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                },
            })

    return Handler


def run_server(host: str, port: int, backend: Backend, models: list[str], provider: str, lease_access=None) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), make_handler(backend, models, provider, lease_access))
    return server


def main() -> None:
    host = os.environ.get("INFERENCE_HOST", "0.0.0.0")
    port = int(os.environ.get("INFERENCE_PORT", "8100"))
    backend_name = os.environ.get("INFERENCE_BACKEND", "echo")
    models = os.environ.get("MODELS", "llama-3.1-8b,mistral-7b").split(",")
    provider = os.environ.get("PROVIDER_ADDRESS", "0x0000000000000000000000000000000000000000")
    server = run_server(host, port, make_backend(backend_name), [m.strip() for m in models], provider)
    print(f"[inference] serving {backend_name} on {host}:{port} models={models}")
    server.serve_forever()


if __name__ == "__main__":
    main()
