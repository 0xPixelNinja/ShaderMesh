"""Lease workload sandbox and lifecycle tests without a Docker daemon or GPU."""

from __future__ import annotations

import pytest

from executor import DockerLeaseExecutor, LeaseWorkload
from rental import RentalProvider, is_content_addressed_manifest

DIGEST_IMAGE = "registry.example/worker@sha256:" + "a" * 64
MANIFEST = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3ayu5ol5qi2ngv3a6h4q"


class FakeNotFound(Exception):
    pass


class FakeContainer:
    def __init__(self, owner, name: str, labels: dict[str, str], health: str | None = None):
        self.owner = owner
        self.name = name
        self.status = "running"
        state = {} if health is None else {"Health": {"Status": health}}
        self.attrs = {"Config": {"Labels": labels}, "State": state}
        self.stopped = False
        self.removed = False

    def reload(self) -> None:
        pass

    def stop(self, timeout: int) -> None:
        assert timeout == 10
        self.status = "exited"
        self.stopped = True

    def remove(self, force: bool) -> None:
        assert force is True
        self.removed = True
        self.owner.items.pop(self.name, None)


class FakeContainers:
    def __init__(self):
        self.items: dict[str, FakeContainer] = {}
        self.runs: list[dict] = []

    def run(self, **kwargs):
        self.runs.append(kwargs)
        container = FakeContainer(self, kwargs["name"], kwargs["labels"])
        self.items[container.name] = container
        return container

    def get(self, name: str):
        if name not in self.items:
            raise FakeNotFound(name)
        return self.items[name]

    def list(self, **_kwargs):
        return list(self.items.values())


class FakeDocker:
    def __init__(self):
        self.containers = FakeContainers()


def _executor(client: FakeDocker, **kwargs) -> DockerLeaseExecutor:
    return DockerLeaseExecutor(
        "0xAbC123",
        client=client,
        not_found_error=FakeNotFound,
        **kwargs,
    )


def test_lease_workload_runs_with_mandatory_sandbox_controls():
    client = FakeDocker()
    executor = _executor(client, mem_limit="2g", cpu_count=1.5, pids_limit=64)
    workload = LeaseWorkload(
        DIGEST_IMAGE,
        command=("worker", "--serve"),
        environment={"MODEL": "small"},
    )

    executor.ensure_started(7, workload)
    executor.ensure_started(7, workload)

    assert len(client.containers.runs) == 1
    run = client.containers.runs[0]
    assert run["image"] == DIGEST_IMAGE
    assert run["command"] == ["worker", "--serve"]
    assert run["environment"] == {"MODEL": "small"}
    assert run["network_disabled"] is True
    assert run["read_only"] is True
    assert run["cap_drop"] == ["ALL"]
    assert run["security_opt"] == ["no-new-privileges:true"]
    assert run["user"] == "65532:65532"
    assert run["mem_limit"] == run["memswap_limit"] == "2g"
    assert run["nano_cpus"] == 1_500_000_000
    assert run["pids_limit"] == 64
    assert run["tmpfs"] == {"/tmp": "rw,noexec,nosuid,size=64m"}
    assert "volumes" not in run
    assert "device_requests" not in run
    assert executor.is_healthy(7) is True
    assert executor.managed_lease_ids() == {7}

    executor.ensure_started(7, LeaseWorkload(DIGEST_IMAGE, command=("worker", "--new")))
    assert len(client.containers.runs) == 2

    container = next(iter(client.containers.items.values()))
    executor.stop(7)
    assert container.stopped is True
    assert container.removed is True
    assert executor.managed_lease_ids() == set()


def test_lease_workload_requires_digest_and_bounded_inputs():
    executor = _executor(FakeDocker())

    with pytest.raises(ValueError, match="immutable sha256 digest"):
        executor.ensure_started(1, LeaseWorkload("worker:latest"))
    with pytest.raises(ValueError, match="environment key"):
        LeaseWorkload(DIGEST_IMAGE, environment={"BAD-KEY": "value"}).validate()
    with pytest.raises(ValueError, match="too many environment"):
        LeaseWorkload(
            DIGEST_IMAGE,
            environment={f"KEY_{i}": "value" for i in range(33)},
        ).validate()


def test_lease_manifest_must_be_content_addressed():
    assert is_content_addressed_manifest(MANIFEST) is True
    assert is_content_addressed_manifest("https://example.test/manifest.json") is False

    with pytest.raises(ValueError, match="content-addressed URI"):
        RentalProvider(
            FakeChain(),
            spec="{}",
            price_per_interval=1,
            interval_secs=60,
            allowed_manifest="ipfs://not-a-cid",
        )


def test_gpu_access_is_explicit_and_uses_selected_devices():
    workload = LeaseWorkload(DIGEST_IMAGE, gpu=True)
    disabled = _executor(FakeDocker())
    with pytest.raises(ValueError, match="GPU support is disabled"):
        disabled.ensure_started(1, workload)

    client = FakeDocker()
    enabled = _executor(
        client,
        gpu_enabled=True,
        gpu_device_ids=("1",),
        device_request_factory=lambda **request: request,
    )
    enabled.ensure_started(2, workload)
    assert client.containers.runs[0]["device_requests"] == [
        {"driver": "nvidia", "capabilities": [["gpu"]], "device_ids": ["1"]}
    ]


def test_unhealthy_or_unowned_containers_are_not_accepted():
    client = FakeDocker()
    executor = _executor(client)
    executor.ensure_started(4, LeaseWorkload(DIGEST_IMAGE))
    container = next(iter(client.containers.items.values()))

    container.attrs["State"] = {"Health": {"Status": "unhealthy"}}
    assert executor.is_healthy(4) is False

    container.attrs["Config"]["Labels"]["shadermesh.provider"] = "0xother"
    with pytest.raises(RuntimeError, match="unowned container"):
        executor.stop(4)


class FakeLeaseExecutor:
    def __init__(self):
        self.managed = {2, 3}
        self.healthy = {1}
        self.started: list[int] = []
        self.stopped: list[int] = []

    def ensure_started(self, lease_id: int, _workload: LeaseWorkload) -> None:
        self.started.append(lease_id)
        self.managed.add(lease_id)

    def is_healthy(self, lease_id: int) -> bool:
        return lease_id in self.healthy

    def stop(self, lease_id: int) -> None:
        self.stopped.append(lease_id)
        self.managed.discard(lease_id)

    def managed_lease_ids(self) -> set[int]:
        return set(self.managed)


class FakeRentalFunctions:
    def heartbeat(self, lease_id: int):
        return ("heartbeat", lease_id)


class FakeRental:
    def __init__(self):
        self.functions = FakeRentalFunctions()


class FakeChain:
    address = "0xAbC123"

    def __init__(self):
        self.rental = FakeRental()
        self.transactions: list[tuple[str, int]] = []

    def tx(self, call):
        self.transactions.append(call)


def test_rental_provider_heartbeats_only_healthy_workloads():
    chain = FakeChain()
    runtime = FakeLeaseExecutor()
    provider = RentalProvider(
        chain,
        spec="{}",
        price_per_interval=1,
        interval_secs=60,
        allowed_manifest=MANIFEST,
        lease_executor=runtime,
        lease_workload=LeaseWorkload(DIGEST_IMAGE),
    )
    provider.serving_leases = lambda: iter((1, 2))
    provider.heartbeat_due = lambda lease_id: lease_id == 1

    assert provider.reconcile_workloads() == 1
    assert runtime.stopped == [3]
    assert runtime.started == [1, 2]
    assert chain.transactions == [("heartbeat", 1)]
