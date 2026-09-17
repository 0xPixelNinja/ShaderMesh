"""Storage backends for job inputs and outputs.

Both backends are content addressed so a returned identifier is a stable
reference to the exact bytes. `LocalDirStorage` is used for fast, dependency
free tests. `IpfsStorage` is used by the real stack.
"""

from __future__ import annotations

import hashlib
import os
import time
from typing import Callable, Protocol

from retry import RetryPolicy, retry_call


class Storage(Protocol):
    def put(self, data: bytes) -> str: ...
    def get(self, cid: str) -> bytes: ...


class LocalDirStorage:
    """Filesystem storage keyed by the SHA-256 of the content."""

    def __init__(self, root: str):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def put(self, data: bytes) -> str:
        key = hashlib.sha256(data).hexdigest()
        with open(os.path.join(self.root, key), "wb") as f:
            f.write(data)
        return f"local://{key}"

    def get(self, cid: str) -> bytes:
        key = cid.split("://", 1)[-1]
        with open(os.path.join(self.root, key), "rb") as f:
            return f.read()


class IpfsStorage:
    """IPFS (Kubo) HTTP API storage."""

    def __init__(
        self,
        api_url: str,
        *,
        retry_policy: RetryPolicy | None = None,
        sleep: Callable[[float], None] = time.sleep,
        post: Callable[..., object] | None = None,
    ):
        self.api_url = api_url.rstrip("/")
        self.retry_policy = retry_policy or RetryPolicy()
        self.sleep = sleep
        self._post = post

    @staticmethod
    def _is_transient(exc: Exception) -> bool:
        response = getattr(exc, "response", None)
        status = getattr(response, "status_code", None)
        if status is not None:
            return status in (408, 425, 429) or 500 <= status < 600
        names = {cls.__name__ for cls in type(exc).__mro__}
        return bool(names & {"Timeout", "ConnectTimeout", "ReadTimeout", "ConnectionError"})

    def _request(self, path: str, **kwargs):
        if self._post is None:
            import requests  # lazy import so tests do not need it

            post = requests.post
        else:
            post = self._post

        def request():
            response = post(f"{self.api_url}{path}", timeout=30, **kwargs)
            response.raise_for_status()
            return response

        return retry_call(
            request,
            policy=self.retry_policy,
            is_retryable=self._is_transient,
            sleep=self.sleep,
        )

    def put(self, data: bytes) -> str:
        resp = self._request("/api/v0/add", files={"file": data})
        return f"ipfs://{resp.json()['Hash']}"

    def get(self, cid: str) -> bytes:
        h = cid.split("://", 1)[-1]
        resp = self._request("/api/v0/cat", params={"arg": h})
        return resp.content


def make_storage(
    backend: str,
    *,
    root: str = "./data",
    ipfs_api_url: str = "http://127.0.0.1:5001",
    retry_policy: RetryPolicy | None = None,
) -> Storage:
    if backend == "ipfs":
        return IpfsStorage(ipfs_api_url, retry_policy=retry_policy)
    return LocalDirStorage(root)
