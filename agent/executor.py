"""Job executor backends.

`LocalExecutor` runs the deterministic render script in a subprocess. It is used
for fast tests and for machines without a container runtime. `DockerExecutor`
runs the job in a constrained container and is the default for the real stack.
Both run identical job code, so their outputs match for the same input.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import uuid
from dataclasses import dataclass, field
from typing import Callable, Mapping, Protocol


class Executor(Protocol):
    def run(self, manifest: dict) -> bytes: ...


@dataclass(frozen=True)
class LeaseWorkload:
    """Provider-approved workload attached to each lease served by this agent."""

    image: str
    command: tuple[str, ...] = ()
    environment: Mapping[str, str] = field(default_factory=dict)
    gpu: bool = False

    def validate(self, *, allow_mutable_image: bool = False) -> None:
        if not self.image or len(self.image) > 512 or any(c.isspace() for c in self.image):
            raise ValueError("lease workload image is invalid")
        if not allow_mutable_image and not re.fullmatch(
            r"[^@]+@sha256:[0-9a-fA-F]{64}", self.image
        ):
            raise ValueError("lease workload image must use an immutable sha256 digest")
        if len(self.command) > 64 or any(
            not isinstance(arg, str) or not arg or len(arg) > 4096 for arg in self.command
        ):
            raise ValueError("lease workload command is invalid")
        if sum(len(arg) for arg in self.command) > 16_384:
            raise ValueError("lease workload command is too large")
        if len(self.environment) > 32:
            raise ValueError("lease workload has too many environment variables")
        for key, value in self.environment.items():
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", key):
                raise ValueError(f"lease workload environment key is invalid: {key}")
            if not isinstance(value, str) or len(value) > 4096:
                raise ValueError(f"lease workload environment value is invalid: {key}")


class LeaseExecutor(Protocol):
    def ensure_started(self, lease_id: int, workload: LeaseWorkload) -> None: ...

    def is_healthy(self, lease_id: int) -> bool: ...

    def stop(self, lease_id: int) -> None: ...

    def managed_lease_ids(self) -> set[int]: ...


class _ContainerNotFound(Exception):
    pass


class DockerLeaseExecutor:
    """Run one recoverable, tightly constrained container for each active lease."""

    def __init__(
        self,
        provider_address: str,
        *,
        client=None,
        mem_limit: str = "4g",
        cpu_count: float = 1.0,
        pids_limit: int = 256,
        user: str = "65532:65532",
        tmpfs_size: str = "64m",
        gpu_enabled: bool = False,
        gpu_device_ids: tuple[str, ...] = (),
        allow_mutable_images: bool = False,
        not_found_error: type[Exception] | tuple[type[Exception], ...] | None = None,
        device_request_factory: Callable[..., object] | None = None,
    ):
        if cpu_count <= 0 or pids_limit <= 0:
            raise ValueError("lease workload resource limits must be positive")
        if client is None:
            import docker  # lazy import keeps the module importable without the SDK

            client = docker.from_env()
            not_found_error = docker.errors.NotFound
            device_request_factory = docker.types.DeviceRequest

        self.client = client
        self.provider_address = provider_address.lower()
        self.mem_limit = mem_limit
        self.nano_cpus = int(cpu_count * 1_000_000_000)
        self.pids_limit = pids_limit
        self.user = user
        self.tmpfs_size = tmpfs_size
        self.gpu_enabled = gpu_enabled
        self.gpu_device_ids = gpu_device_ids
        self.allow_mutable_images = allow_mutable_images
        self.not_found_error = not_found_error or _ContainerNotFound
        self.device_request_factory = device_request_factory

    def ensure_started(self, lease_id: int, workload: LeaseWorkload) -> None:
        workload.validate(allow_mutable_image=self.allow_mutable_images)
        if workload.gpu and not self.gpu_enabled:
            raise ValueError("lease workload requested GPU access but GPU support is disabled")

        existing = self._get(lease_id)
        if existing is not None:
            self._assert_owned(existing, lease_id)
            existing.reload()
            labels = existing.attrs.get("Config", {}).get("Labels", {})
            if labels.get("shadermesh.workload") == self._workload_id(workload):
                if existing.status == "running":
                    return
            if existing.status == "running":
                existing.stop(timeout=10)
            existing.remove(force=True)

        kwargs = {
            "image": workload.image,
            "command": list(workload.command) or None,
            "environment": dict(workload.environment),
            "name": self._name(lease_id),
            "labels": {
                **self._labels(lease_id),
                "shadermesh.workload": self._workload_id(workload),
            },
            "detach": True,
            "network_disabled": True,
            "read_only": True,
            "cap_drop": ["ALL"],
            "security_opt": ["no-new-privileges:true"],
            "user": self.user,
            "mem_limit": self.mem_limit,
            "memswap_limit": self.mem_limit,
            "nano_cpus": self.nano_cpus,
            "pids_limit": self.pids_limit,
            "tmpfs": {"/tmp": f"rw,noexec,nosuid,size={self.tmpfs_size}"},
            "init": True,
            "restart_policy": {"Name": "no"},
        }
        if workload.gpu:
            if self.device_request_factory is None:
                raise RuntimeError("Docker GPU device request support is unavailable")
            request = {
                "driver": "nvidia",
                "capabilities": [["gpu"]],
            }
            if self.gpu_device_ids:
                request["device_ids"] = list(self.gpu_device_ids)
            else:
                request["count"] = -1
            kwargs["device_requests"] = [self.device_request_factory(**request)]

        self.client.containers.run(**kwargs)

    def is_healthy(self, lease_id: int) -> bool:
        container = self._get(lease_id)
        if container is None:
            return False
        self._assert_owned(container, lease_id)
        container.reload()
        if container.status != "running":
            return False
        health = container.attrs.get("State", {}).get("Health", {}).get("Status")
        return health in (None, "healthy")

    def stop(self, lease_id: int) -> None:
        container = self._get(lease_id)
        if container is None:
            return
        self._assert_owned(container, lease_id)
        container.reload()
        if container.status == "running":
            container.stop(timeout=10)
        container.remove(force=True)

    def managed_lease_ids(self) -> set[int]:
        containers = self.client.containers.list(
            all=True,
            filters={
                "label": [
                    "shadermesh.managed=true",
                    f"shadermesh.provider={self.provider_address}",
                ]
            },
        )
        lease_ids: set[int] = set()
        for container in containers:
            raw = container.attrs.get("Config", {}).get("Labels", {}).get(
                "shadermesh.lease_id"
            )
            try:
                lease_ids.add(int(raw))
            except (TypeError, ValueError):
                continue
        return lease_ids

    def _get(self, lease_id: int):
        try:
            return self.client.containers.get(self._name(lease_id))
        except self.not_found_error:
            return None

    def _assert_owned(self, container, lease_id: int) -> None:
        labels = container.attrs.get("Config", {}).get("Labels", {})
        expected = self._labels(lease_id)
        if any(labels.get(key) != value for key, value in expected.items()):
            raise RuntimeError(f"refusing to manage unowned container for lease {lease_id}")

    def _labels(self, lease_id: int) -> dict[str, str]:
        return {
            "shadermesh.managed": "true",
            "shadermesh.lease_id": str(lease_id),
            "shadermesh.provider": self.provider_address,
        }

    def _name(self, lease_id: int) -> str:
        provider = re.sub(r"[^a-z0-9]", "", self.provider_address)[-12:] or "provider"
        return f"shadermesh-lease-{provider}-{lease_id}"

    @staticmethod
    def _workload_id(workload: LeaseWorkload) -> str:
        encoded = json.dumps(
            {
                "image": workload.image,
                "command": workload.command,
                "environment": dict(workload.environment),
                "gpu": workload.gpu,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()


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

    _ARCHIVE_OVERHEAD_LIMIT = 1024 * 1024
    _LOG_LIMIT = 16 * 1024
    _HELPER_SCRIPT = "import time; time.sleep(300)"
    _INITIALIZE_IO_SCRIPT = "import os; os.chmod('/io', 0o1777)"

    def __init__(
        self,
        image: str,
        mem_limit: str = "512m",
        *,
        client=None,
        cpu_count: float = 1.0,
        pids_limit: int = 128,
        user: str = "65532:65532",
        tmpfs_size: str = "64m",
        helper_image: str = "shadermesh/agent",
    ):
        if cpu_count <= 0 or pids_limit <= 0:
            raise ValueError("task container resource limits must be positive")
        if client is None:
            import docker  # lazy import so tests do not need the SDK

            client = docker.from_env()

        self.client = client
        self.image = image
        self.mem_limit = mem_limit
        self.nano_cpus = int(cpu_count * 1_000_000_000)
        self.pids_limit = pids_limit
        self.user = user
        self.tmpfs_size = tmpfs_size
        self.helper_image = helper_image

    def run(self, manifest: dict) -> bytes:
        task_id = uuid.uuid4().hex
        volume_name = f"shadermesh-task-io-{task_id}"
        common_labels = {
            "shadermesh.managed": "true",
            "shadermesh.component": "agent",
            "shadermesh.task_id": task_id,
        }
        volume = None
        helper = None
        container = None
        try:
            volume = self.client.volumes.create(
                name=volume_name,
                driver="local",
                driver_opts={
                    "type": "tmpfs",
                    "device": "tmpfs",
                    "o": f"rw,noexec,nosuid,size={self.tmpfs_size}",
                },
                labels={**common_labels, "shadermesh.resource": "task-io"},
            )
            helper = self.client.containers.create(
                self.helper_image,
                command=["python", "-c", self._HELPER_SCRIPT],
                labels={**common_labels, "shadermesh.resource": "task-helper"},
                network_disabled=True,
                read_only=True,
                cap_drop=["ALL"],
                security_opt=["no-new-privileges:true"],
                user="0:0",
                mem_limit=self.mem_limit,
                memswap_limit=self.mem_limit,
                nano_cpus=self.nano_cpus,
                pids_limit=self.pids_limit,
                tmpfs={"/tmp": f"rw,noexec,nosuid,size={self.tmpfs_size}"},
                volumes={volume_name: {"bind": "/io", "mode": "rw"}},
                init=True,
            )
            try:
                helper.start()
                init_result = helper.exec_run(
                    ["python", "-c", self._INITIALIZE_IO_SCRIPT]
                )
                init_status = getattr(init_result, "exit_code", None)
                if init_status is None and isinstance(init_result, tuple):
                    init_status = init_result[0]
                if init_status != 0:
                    raise RuntimeError(
                        f"helper initialization exited with status {init_status}"
                    )
                uploaded = helper.put_archive("/io", self._manifest_archive(manifest))
                if uploaded is False:
                    raise RuntimeError("Docker refused the archive")
            except Exception as exc:
                raise self._failure(helper, f"task manifest upload failed: {exc}") from exc
            container = self.client.containers.create(
                self.image,
                command=["/io/manifest.json", "/io/out.png"],
                labels={**common_labels, "shadermesh.resource": "task"},
                network_disabled=True,
                read_only=True,
                cap_drop=["ALL"],
                security_opt=["no-new-privileges:true"],
                user=self.user,
                mem_limit=self.mem_limit,
                memswap_limit=self.mem_limit,
                nano_cpus=self.nano_cpus,
                pids_limit=self.pids_limit,
                tmpfs={"/tmp": f"rw,noexec,nosuid,size={self.tmpfs_size}"},
                volumes={volume_name: {"bind": "/io", "mode": "rw"}},
                init=True,
            )
            try:
                container.start()
            except Exception as exc:
                raise self._failure(container, f"task container failed to start: {exc}") from exc
            try:
                wait_result = container.wait()
            except Exception as exc:
                raise self._failure(container, f"task container wait failed: {exc}") from exc
            status = (
                wait_result.get("StatusCode")
                if isinstance(wait_result, Mapping)
                else wait_result
            )
            if not isinstance(status, int) or isinstance(status, bool):
                raise self._failure(container, "task container returned an invalid exit status")
            if status != 0:
                raise self._failure(container, f"task container exited with status {status}")
            return self._output(container)
        finally:
            active_error = sys.exc_info()[0]
            cleanup_error = None
            for resource in (container, helper, volume):
                if resource is None:
                    continue
                try:
                    resource.remove(force=True)
                except Exception as exc:
                    if cleanup_error is None:
                        cleanup_error = exc
            if active_error is None and cleanup_error is not None:
                raise cleanup_error

    @staticmethod
    def _manifest_archive(manifest: dict) -> bytes:
        payload = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w") as tar:
            info = tarfile.TarInfo("manifest.json")
            info.size = len(payload)
            info.mode = 0o444
            info.mtime = 0
            tar.addfile(info, io.BytesIO(payload))
        return archive.getvalue()

    def _output(self, container) -> bytes:
        try:
            chunks, metadata = container.get_archive("/io/out.png")
        except Exception as exc:
            raise self._failure(
                container, "task output /io/out.png is missing or could not be retrieved"
            ) from exc

        size = metadata.get("size") if isinstance(metadata, Mapping) else None
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            raise self._failure(container, "task container produced invalid or empty output")

        archive = io.BytesIO()
        archive_limit = size + self._ARCHIVE_OVERHEAD_LIMIT
        try:
            for chunk in chunks:
                if not isinstance(chunk, (bytes, bytearray)):
                    raise ValueError("archive stream contained non-bytes data")
                if archive.tell() + len(chunk) > archive_limit:
                    raise ValueError("output archive exceeded its size limit")
                archive.write(chunk)
            archive.seek(0)
            with tarfile.open(fileobj=archive, mode="r:*") as tar:
                members = tar.getmembers()
                if len(members) != 1:
                    raise ValueError("output archive must contain exactly one file")
                member = members[0]
                if member.name != "out.png" or not member.isfile() or member.size != size:
                    raise ValueError("output archive did not contain the expected regular file")
                output_file = tar.extractfile(member)
                if output_file is None:
                    raise ValueError("output archive file could not be read")
                output = output_file.read(size + 1)
                if len(output) != size:
                    raise ValueError("output archive file size did not match Docker metadata")
                return output
        except Exception as exc:
            raise self._failure(container, f"task container produced invalid output: {exc}") from exc

    def _failure(self, container, message: str) -> RuntimeError:
        try:
            raw_logs = container.logs(stdout=True, stderr=True, tail=200)
            if isinstance(raw_logs, str):
                raw_logs = raw_logs.encode("utf-8", errors="replace")
            elif not isinstance(raw_logs, bytes):
                raw_logs = bytes(raw_logs)
            logs = raw_logs[-self._LOG_LIMIT :].decode("utf-8", errors="replace")
        except Exception as exc:
            logs = f"<logs unavailable: {exc}>"
        return RuntimeError(f"{message}; logs: {logs or '<empty>'}")


def make_executor(
    backend: str,
    *,
    render_script: str = "",
    image: str = "shadermesh/job-deterministic",
    mem_limit: str = "512m",
    cpu_count: float = 1.0,
    pids_limit: int = 128,
    user: str = "65532:65532",
    tmpfs_size: str = "64m",
    helper_image: str = "shadermesh/agent",
) -> Executor:
    if backend == "docker":
        return DockerExecutor(
            image,
            mem_limit=mem_limit,
            cpu_count=cpu_count,
            pids_limit=pids_limit,
            user=user,
            tmpfs_size=tmpfs_size,
            helper_image=helper_image,
        )
    return LocalExecutor(render_script)
