"""Bounded retry helpers for transient external service failures."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Callable, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 4
    initial_delay: float = 0.5
    max_delay: float = 4.0
    multiplier: float = 2.0

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise ValueError("retry max attempts must be at least 1")
        if self.initial_delay < 0 or self.max_delay < 0:
            raise ValueError("retry delays must not be negative")
        if self.multiplier < 1:
            raise ValueError("retry multiplier must be at least 1")

    @classmethod
    def from_env(cls) -> "RetryPolicy":
        return cls(
            max_attempts=int(os.environ.get("RETRY_MAX_ATTEMPTS", "4")),
            initial_delay=float(os.environ.get("RETRY_INITIAL_DELAY_SECS", "0.5")),
            max_delay=float(os.environ.get("RETRY_MAX_DELAY_SECS", "4")),
            multiplier=float(os.environ.get("RETRY_BACKOFF_MULTIPLIER", "2")),
        )


def retry_call(
    operation: Callable[[], T],
    *,
    policy: RetryPolicy,
    is_retryable: Callable[[Exception], bool],
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    """Run an operation with bounded exponential backoff for transient errors."""
    delay = min(policy.initial_delay, policy.max_delay)
    for attempt in range(1, policy.max_attempts + 1):
        try:
            return operation()
        except Exception as exc:
            if attempt == policy.max_attempts or not is_retryable(exc):
                raise
            sleep(delay)
            delay = min(delay * policy.multiplier, policy.max_delay)
    raise AssertionError("retry loop exhausted without returning or raising")
