"""Benchmark challenge workload, scoring, and provider-side responder.

The registry attester issues a challenge with an on-chain random seed. The
provider must return the output of a fixed sequential hash chain seeded by it
and a measured performance score. The chain cannot be precomputed (the seed is
unknown until issued) or parallelised (each step needs the previous one), so a
correct hash within the deadline shows the provider is live and doing real work.

Workload: h0 = seed, h_{i+1} = sha256(h_i), output = h_N with
N = CHALLENGE_ITERATIONS. The attester recomputes the same chain to judge.

Score: tokens per second times 100 when an Ollama backend is configured, else
the hash-chain rate in kH/s. Run `python benchmark.py` to print the score an
operator can use as the attested benchmark score.

Config via environment:
  INFERENCE_BACKEND, OLLAMA_URL, MODELS (first model is benchmarked),
  BENCHMARK_FAULT ("" | "wrong_hash" | "silent") for slashing demos.
"""

from __future__ import annotations

import hashlib
import os
import sys
import time
from typing import Callable

# Shared by the provider (respond) and the attester (judge). Roughly 0.5 to 1s in CPython.
CHALLENGE_ITERATIONS = 500_000

BENCHMARK_PROMPT = "Count from one to twenty in words, separated by commas."
BENCHMARK_MAX_TOKENS = 64

CHALLENGE_OPEN = 1
CHALLENGE_RESPONDED = 2

FAULTS = ("", "wrong_hash", "silent")


def hash_chain(seed: bytes, iterations: int = CHALLENGE_ITERATIONS) -> bytes:
    """Return h_N of the sequential sha256 chain starting at the seed."""
    if len(seed) != 32:
        raise ValueError("seed must be 32 bytes")
    if iterations < 0:
        raise ValueError("iterations must be non-negative")
    digest = seed
    sha256 = hashlib.sha256
    for _ in range(iterations):
        digest = sha256(digest).digest()
    return digest


def hash_rate_score(iterations: int, elapsed_secs: float) -> int:
    """Hash-chain rate in kH/s, never below 1."""
    if elapsed_secs <= 0:
        return 1
    return max(1, int(iterations / elapsed_secs / 1000))


def tokens_per_sec_score(eval_count: int, eval_duration_ns: int) -> int:
    """Ollama generation speed as int(tokens per second * 100)."""
    if eval_count <= 0 or eval_duration_ns <= 0:
        raise ValueError("ollama reported no generation timing")
    return int(eval_count / (eval_duration_ns / 1e9) * 100)


def ollama_score(url: str, model: str, timeout: float = 120.0) -> int:
    """Measure tokens/sec on a fixed prompt at temperature 0."""
    import requests  # lazy

    resp = requests.post(
        f"{url.rstrip('/')}/api/generate",
        json={
            "model": model,
            "prompt": BENCHMARK_PROMPT,
            "stream": False,
            "options": {"temperature": 0, "num_predict": BENCHMARK_MAX_TOKENS},
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    body = resp.json()
    return tokens_per_sec_score(int(body.get("eval_count", 0)), int(body.get("eval_duration", 0)))


def measure(
    seed: bytes,
    iterations: int = CHALLENGE_ITERATIONS,
    *,
    backend: str = "echo",
    ollama_url: str = "http://127.0.0.1:11434",
    model: str = "",
    clock: Callable[[], float] = time.perf_counter,
) -> tuple[bytes, int, str]:
    """Run the workload. Returns (output hash, score, score kind)."""
    start = clock()
    output = hash_chain(seed, iterations)
    elapsed = clock() - start
    if backend == "ollama" and model:
        try:
            return output, ollama_score(ollama_url, model), "tokens_per_sec_x100"
        except Exception as exc:
            print(f"[benchmark] ollama score unavailable ({exc}); using hash rate")
    return output, hash_rate_score(iterations, elapsed), "khash_per_sec"


def _backend_settings() -> tuple[str, str, str]:
    models = [m.strip() for m in os.environ.get("MODELS", "").split(",") if m.strip()]
    return (
        os.environ.get("INFERENCE_BACKEND", "echo"),
        os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"),
        models[0] if models else "",
    )


def respond_to_challenge(chain, fault: str | None = None) -> int | None:
    """Answer this provider's open challenge, if any. Returns the id answered."""
    fault = os.environ.get("BENCHMARK_FAULT", "") if fault is None else fault
    if fault not in FAULTS:
        raise ValueError(f"BENCHMARK_FAULT must be one of {FAULTS}")
    registry = chain.registry
    challenge_id = int(chain.call(registry.functions.openChallenge(chain.address)))
    if challenge_id == 0:
        return None
    challenge = chain.call(registry.functions.challenges(challenge_id))
    seed, deadline, status = bytes(challenge[1]), int(challenge[3]), int(challenge[5])
    if status != CHALLENGE_OPEN:
        return None
    if fault == "silent":
        print(f"[benchmark] challenge #{challenge_id} ignored (fault=silent)")
        return None
    now = int(chain.rpc(lambda: chain.w3.eth.get_block("latest"))["timestamp"])
    if now > deadline:
        print(f"[benchmark] challenge #{challenge_id} missed its deadline")
        return None

    backend, url, model = _backend_settings()
    output, score, kind = measure(seed, backend=backend, ollama_url=url, model=model)
    if fault == "wrong_hash":
        output = hashlib.sha256(b"wrong" + seed).digest()
    chain.tx(registry.functions.respondChallenge(challenge_id, score, output))
    print(
        f"[benchmark] challenge #{challenge_id} answered score={score} ({kind})"
        + (" fault=wrong_hash" if fault == "wrong_hash" else "")
    )
    return challenge_id


def main() -> None:
    backend, url, model = _backend_settings()
    seed = hashlib.sha256(b"shadermesh-benchmark-cli").digest()
    start = time.perf_counter()
    output, score, kind = measure(seed, backend=backend, ollama_url=url, model=model)
    print(f"iterations={CHALLENGE_ITERATIONS} elapsed={time.perf_counter() - start:.2f}s")
    print(f"score_kind={kind}")
    print(score)


if __name__ == "__main__":
    sys.exit(main())
