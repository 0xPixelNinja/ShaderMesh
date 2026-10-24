"""Unit tests for the benchmark workload and the attester judging logic."""

from __future__ import annotations

import hashlib

import pytest

from attester import AttesterConfig, judge
from benchmark import (
    hash_chain,
    hash_rate_score,
    measure,
    tokens_per_sec_score,
)

SEED = hashlib.sha256(b"seed").digest()
N = 1000


def _manual(seed: bytes, n: int) -> bytes:
    digest = seed
    for _ in range(n):
        digest = hashlib.sha256(digest).digest()
    return digest


def test_hash_chain_is_deterministic_and_sequential():
    assert hash_chain(SEED, N) == hash_chain(SEED, N)
    assert hash_chain(SEED, N) == _manual(SEED, N)
    assert hash_chain(SEED, 0) == SEED
    assert hash_chain(SEED, 1) == hashlib.sha256(SEED).digest()
    assert hash_chain(SEED, N) != hash_chain(hashlib.sha256(b"other").digest(), N)


def test_hash_chain_rejects_bad_input():
    with pytest.raises(ValueError):
        hash_chain(b"short", N)
    with pytest.raises(ValueError):
        hash_chain(SEED, -1)


def test_scores():
    assert hash_rate_score(1_000_000, 1.0) == 1000
    assert hash_rate_score(10, 0) == 1
    assert tokens_per_sec_score(50, 1_000_000_000) == 5000
    with pytest.raises(ValueError):
        tokens_per_sec_score(0, 1)


def test_measure_uses_hash_rate_without_ollama():
    ticks = iter([0.0, 2.0])
    output, score, kind = measure(SEED, 2000, clock=lambda: next(ticks))
    assert output == _manual(SEED, 2000)
    assert (score, kind) == (1, "khash_per_sec")


def test_judge_passes_correct_hash_and_score():
    out = hash_chain(SEED, N)
    assert judge(SEED, 600, out, 1000, 5000, N) == (True, "ok")
    assert judge(SEED, 500, out, 1000, 5000, N)[0] is True  # exactly at the floor


def test_judge_fails_wrong_hash():
    passed, reason = judge(SEED, 10_000, b"\x01" * 32, 1000, 5000, N)
    assert not passed and "mismatch" in reason


def test_judge_fails_low_score():
    passed, reason = judge(SEED, 499, hash_chain(SEED, N), 1000, 5000, N)
    assert not passed and "below" in reason


def test_judge_zero_attested_score_has_no_floor():
    assert judge(SEED, 0, hash_chain(SEED, N), 0, 5000, N)[0] is True


def test_config_validation():
    with pytest.raises(ValueError):
        AttesterConfig(interval_secs=0)
    with pytest.raises(ValueError):
        AttesterConfig(min_score_bps=10_001)
