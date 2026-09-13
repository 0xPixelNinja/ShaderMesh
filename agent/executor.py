"""Job executor backends.

`LocalExecutor` runs the deterministic render script in a subprocess. It is used
for fast tests and for machines without a container runtime. `DockerExecutor`
runs the job in a constrained container and is the default for the real stack.
Both run identical job code, so their outputs match for the same input.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from typing import Protocol


class Executor(Protocol):
    def run(self, manifest: dict) -> bytes: ...


class LocalExecutor:
    """Run the render script directly with the current Python interpreter."""

    def __init__(self, render_script: str):
        self.render_script = render_script

    def run(self, manifest: dict) -> bytes:
        with tempfile.TemporaryDirectory() as d:
            mpath = os.path.join(d, "manifest.json")
            opath = os.path.join(d, "out.png")
            with open(mpath, "w", encoding="utf-8") as f:
                json.dump(manifest, f)
            subprocess.run(
                [sys.executable, self.render_script, mpath, opath],
                check=True,
                capture_output=True,
            )
            with open(opath, "rb") as f:
                return f.read()


class DockerExecutor:
    """Run the job in a sandboxed container. Inputs are untrusted, so limits apply."""

    def __init__(self, image: str, mem_limit: str = "512m"):
        import docker  # lazy import so tests do not need the SDK

        self.client = docker.from_env()
        self.image = image
        self.mem_limit = mem_limit

    def run(self, manifest: dict) -> bytes:
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump(manifest, f)
            self.client.containers.run(
                self.image,
                command=["/io/manifest.json", "/io/out.png"],
                volumes={d: {"bind": "/io", "mode": "rw"}},
                network_disabled=True,  # job needs no network
                mem_limit=self.mem_limit,
                remove=True,
            )
            with open(os.path.join(d, "out.png"), "rb") as f:
                return f.read()


def make_executor(
    backend: str,
    *,
    render_script: str = "",
    image: str = "shadermesh/job-deterministic",
) -> Executor:
    if backend == "docker":
        return DockerExecutor(image)
    return LocalExecutor(render_script)
