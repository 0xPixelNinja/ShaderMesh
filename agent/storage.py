"""Storage backends for job inputs and outputs.

Both backends are content addressed so a returned identifier is a stable
reference to the exact bytes. `LocalDirStorage` is used for fast, dependency
free tests. `IpfsStorage` is used by the real stack.
"""

from __future__ import annotations

import hashlib
import os
from typing import Protocol


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

    def __init__(self, api_url: str):
        self.api_url = api_url.rstrip("/")

    def put(self, data: bytes) -> str:
        import requests  # lazy import so tests do not need it

        resp = requests.post(f"{self.api_url}/api/v0/add", files={"file": data}, timeout=30)
        resp.raise_for_status()
        return f"ipfs://{resp.json()['Hash']}"

    def get(self, cid: str) -> bytes:
        import requests  # lazy import

        h = cid.split("://", 1)[-1]
        resp = requests.post(f"{self.api_url}/api/v0/cat", params={"arg": h}, timeout=30)
        resp.raise_for_status()
        return resp.content


def make_storage(backend: str, *, root: str = "./data", ipfs_api_url: str = "http://127.0.0.1:5001") -> Storage:
    if backend == "ipfs":
        return IpfsStorage(ipfs_api_url)
    return LocalDirStorage(root)
