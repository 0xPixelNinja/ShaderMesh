"""Unit tests for task sandboxing, retries, and challenger operation."""

from __future__ import annotations

import io
import json
import tarfile

import pytest

from agent import _rpc_label
from chain import ChainClient, is_transient_rpc_error
from executor import DockerExecutor
from provider import Agent, STATUS_CLAIMED, STATUS_OPEN, STATUS_SUBMITTED
from retry import RetryPolicy, retry_call
from storage import IpfsStorage


def _archive(name: str, content: bytes) -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as tar:
        info = tarfile.TarInfo(name)
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))
    return stream.getvalue()


class FakeContainer:
    def __init__(
        self,
        role: str,
        events: list[str],
        *,
        output: bytes | None = b"rendered",
        status: int = 0,
        logs: bytes = b"",
        fail_stage: str | None = None,
    ):
        self.role = role
        self.events = events
        self.output = output
        self.status = status
        self.log_output = logs
        self.fail_stage = fail_stage
        self.manifest: dict | None = None
        self.started = False
        self.removed = False

    def start(self) -> None:
        self.events.append(f"{self.role}.start")
        if self.fail_stage == "start":
            raise RuntimeError(f"{self.role} start failed")
        self.started = True

    def exec_run(self, command: list[str]):
        self.events.append(f"{self.role}.exec")
        assert command == ["python", "-c", "import os; os.chmod('/io', 0o1777)"]
        if self.fail_stage == "exec":
            return 1, b"initialization failed"
        return 0, b""

    def put_archive(self, path: str, data: bytes) -> bool:
        self.events.append(f"{self.role}.put_archive")
        assert path == "/io"
        if self.fail_stage == "upload":
            raise RuntimeError("upload failed")
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tar:
            members = tar.getmembers()
            assert len(members) == 1
            assert members[0].name == "manifest.json"
            assert members[0].mode == 0o444
            manifest_file = tar.extractfile(members[0])
            assert manifest_file is not None
            self.manifest = json.load(manifest_file)
        return True

    def wait(self) -> dict[str, int]:
        self.events.append(f"{self.role}.wait")
        assert self.started
        if self.fail_stage == "wait":
            raise RuntimeError("wait failed")
        return {"StatusCode": self.status}

    def get_archive(self, path: str):
        self.events.append(f"{self.role}.get_archive")
        assert path == "/io/out.png"
        if self.output is None:
            raise FileNotFoundError(path)
        return iter([_archive("out.png", self.output)]), {"size": len(self.output)}

    def logs(self, **kwargs) -> bytes:
        assert kwargs == {"stdout": True, "stderr": True, "tail": 200}
        return self.log_output

    def remove(self, force: bool) -> None:
        assert force is True
        self.events.append(f"{self.role}.remove")
        self.removed = True


class FakeTaskContainers:
    def __init__(
        self,
        events: list[str],
        task: FakeContainer | None = None,
        helper: FakeContainer | None = None,
        fail_create: str | None = None,
    ):
        self.events = events
        self.task = task or FakeContainer("task", events)
        self.helper = helper or FakeContainer("helper", events)
        self.fail_create = fail_create
        self.creates: list[tuple[str, dict]] = []

    def create(self, image: str, **kwargs) -> FakeContainer:
        self.creates.append((image, kwargs))
        role = "helper" if kwargs["labels"]["shadermesh.resource"] == "task-helper" else "task"
        self.events.append(f"{role}.create")
        if self.fail_create == role:
            raise RuntimeError(f"{role} create failed")
        return self.helper if role == "helper" else self.task


class FakeVolume:
    def __init__(self, name: str, events: list[str]):
        self.name = name
        self.events = events
        self.removed = False

    def remove(self, force: bool) -> None:
        assert force is True
        self.events.append("volume.remove")
        self.removed = True


class FakeVolumes:
    def __init__(self, events: list[str]):
        self.events = events
        self.creates: list[dict] = []
        self.volume: FakeVolume | None = None

    def create(self, **kwargs) -> FakeVolume:
        self.events.append("volume.create")
        self.creates.append(kwargs)
        self.volume = FakeVolume(kwargs["name"], self.events)
        return self.volume


class FakeDocker:
    def __init__(
        self,
        task: FakeContainer | None = None,
        helper: FakeContainer | None = None,
        *,
        fail_create: str | None = None,
        events: list[str] | None = None,
    ):
        self.events = events if events is not None else []
        self.containers = FakeTaskContainers(
            self.events, task, helper, fail_create=fail_create
        )
        self.volumes = FakeVolumes(self.events)


def test_rpc_label_does_not_expose_credentials_or_api_key():
    assert _rpc_label("https://user:pass@example.test/v2/secret?token=value") == "https://example.test"


def test_task_executor_enforces_all_sandbox_controls():
    client = FakeDocker()
    executor = DockerExecutor(
        "job-image",
        client=client,
        mem_limit="256m",
        cpu_count=1.5,
        pids_limit=32,
        user="1234:1234",
        tmpfs_size="16m",
        helper_image="trusted-agent",
    )

    assert executor.run({"task": "render"}) == b"rendered"

    helper_image, helper_run = client.containers.creates[0]
    image, run = client.containers.creates[1]
    volume = client.volumes.creates[0]
    volume_name = volume["name"]
    assert helper_image == "trusted-agent"
    assert image == "job-image"
    assert client.containers.helper.manifest == {"task": "render"}
    assert client.containers.helper.removed is True
    assert client.containers.task.started is True
    assert client.containers.task.removed is True
    assert client.volumes.volume is not None
    assert client.volumes.volume.removed is True
    assert volume_name.startswith("shadermesh-task-io-")
    assert volume["driver"] == "local"
    assert volume["driver_opts"] == {
        "type": "tmpfs",
        "device": "tmpfs",
        "o": "rw,noexec,nosuid,size=16m",
    }
    assert volume["labels"]["shadermesh.managed"] == "true"
    assert volume["labels"]["shadermesh.component"] == "agent"
    assert volume["labels"]["shadermesh.resource"] == "task-io"
    assert helper_run["volumes"] == {volume_name: {"bind": "/io", "mode": "rw"}}
    assert run["volumes"] == {volume_name: {"bind": "/io", "mode": "rw"}}
    assert helper_run["labels"]["shadermesh.task_id"] == run["labels"]["shadermesh.task_id"]
    assert run["network_disabled"] is True
    assert run["read_only"] is True
    assert run["cap_drop"] == ["ALL"]
    assert run["security_opt"] == ["no-new-privileges:true"]
    assert run["user"] == "1234:1234"
    assert run["mem_limit"] == run["memswap_limit"] == "256m"
    assert run["nano_cpus"] == 1_500_000_000
    assert run["pids_limit"] == 32
    assert run["tmpfs"] == {"/tmp": "rw,noexec,nosuid,size=16m"}
    assert run["init"] is True
    assert client.events == [
        "volume.create",
        "helper.create",
        "helper.start",
        "helper.exec",
        "helper.put_archive",
        "task.create",
        "task.start",
        "task.wait",
        "task.get_archive",
        "task.remove",
        "helper.remove",
        "volume.remove",
    ]


def test_task_executor_reports_missing_output_and_cleans_up():
    events: list[str] = []
    container = FakeContainer(
        "task", events, output=None, logs=b"renderer produced no file"
    )
    client = FakeDocker(task=container, events=events)
    executor = DockerExecutor("job-image", client=client)

    with pytest.raises(RuntimeError, match="missing.*renderer produced no file"):
        executor.run({"task": "render"})

    assert container.removed is True
    assert client.volumes.volume is not None and client.volumes.volume.removed is True


def test_task_executor_reports_nonzero_exit_with_bounded_logs_and_cleans_up():
    events: list[str] = []
    container = FakeContainer(
        "task", events, status=9, logs=b"discarded" + b"x" * 20_000 + b"tail"
    )
    client = FakeDocker(task=container, events=events)
    executor = DockerExecutor("job-image", client=client)

    with pytest.raises(RuntimeError, match="exited with status 9") as error:
        executor.run({"task": "render"})

    assert "discarded" not in str(error.value)
    assert str(error.value).endswith("tail")
    assert container.removed is True
    assert client.volumes.volume is not None and client.volumes.volume.removed is True


def test_task_executor_cleans_up_when_manifest_upload_fails():
    events: list[str] = []
    helper = FakeContainer("helper", events, fail_stage="upload")
    client = FakeDocker(helper=helper, events=events)
    executor = DockerExecutor("job-image", client=client)

    with pytest.raises(RuntimeError, match="upload failed"):
        executor.run({"task": "render"})

    assert helper.removed is True
    assert client.containers.task.started is False
    assert client.volumes.volume is not None and client.volumes.volume.removed is True


@pytest.mark.parametrize(
    ("failure", "expected_events"),
    [
        ("helper-create", ["volume.create", "helper.create", "volume.remove"]),
        (
            "helper-start",
            [
                "volume.create",
                "helper.create",
                "helper.start",
                "helper.remove",
                "volume.remove",
            ],
        ),
        (
            "helper-exec",
            [
                "volume.create",
                "helper.create",
                "helper.start",
                "helper.exec",
                "helper.remove",
                "volume.remove",
            ],
        ),
        (
            "task-create",
            [
                "volume.create",
                "helper.create",
                "helper.start",
                "helper.exec",
                "helper.put_archive",
                "task.create",
                "helper.remove",
                "volume.remove",
            ],
        ),
        (
            "task-start",
            [
                "volume.create",
                "helper.create",
                "helper.start",
                "helper.exec",
                "helper.put_archive",
                "task.create",
                "task.start",
                "task.remove",
                "helper.remove",
                "volume.remove",
            ],
        ),
        (
            "task-wait",
            [
                "volume.create",
                "helper.create",
                "helper.start",
                "helper.exec",
                "helper.put_archive",
                "task.create",
                "task.start",
                "task.wait",
                "task.remove",
                "helper.remove",
                "volume.remove",
            ],
        ),
    ],
)
def test_task_executor_cleans_up_each_created_resource_on_failure(
    failure: str, expected_events: list[str]
):
    events: list[str] = []
    helper_stage = failure.removeprefix("helper-") if failure.startswith("helper-") else None
    task_stage = failure.removeprefix("task-") if failure.startswith("task-") else None
    helper = FakeContainer("helper", events, fail_stage=helper_stage)
    task = FakeContainer("task", events, fail_stage=task_stage)
    fail_create = failure.removesuffix("-create") if failure.endswith("-create") else None
    client = FakeDocker(
        task=task,
        helper=helper,
        fail_create=fail_create,
        events=events,
    )

    with pytest.raises(RuntimeError):
        DockerExecutor("job-image", client=client).run({"task": "render"})

    assert events == expected_events


def test_retry_call_uses_bounded_exponential_backoff():
    attempts = 0
    delays: list[float] = []

    def operation() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 4:
            raise ConnectionError("connection reset")
        return "ok"

    result = retry_call(
        operation,
        policy=RetryPolicy(max_attempts=4, initial_delay=0.5, max_delay=1),
        is_retryable=is_transient_rpc_error,
        sleep=delays.append,
    )

    assert result == "ok"
    assert attempts == 4
    assert delays == [0.5, 1, 1]


def test_chain_does_not_retry_contract_revert():
    attempts = 0

    class RevertingTransaction:
        def transact(self) -> None:
            nonlocal attempts
            attempts += 1
            raise ValueError("execution reverted: market: not open")

    client = ChainClient.__new__(ChainClient)
    client.retry_policy = RetryPolicy(max_attempts=4, initial_delay=0, max_delay=0)
    client.sleep = lambda _delay: None

    with pytest.raises(ValueError, match="execution reverted"):
        client.tx(RevertingTransaction())
    assert attempts == 1


class FakeResponse:
    def __init__(self, *, content: bytes = b"", payload: dict | None = None):
        self.content = content
        self.payload = payload or {}

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self.payload


def test_ipfs_retries_transient_operations():
    attempts = 0
    delays: list[float] = []

    def post(url: str, **kwargs):
        nonlocal attempts
        attempts += 1
        assert url.endswith("/api/v0/add")
        assert kwargs["files"] == {"file": b"output"}
        if attempts == 1:
            raise ConnectionError("connection refused")
        return FakeResponse(payload={"Hash": "bafy-output"})

    storage = IpfsStorage(
        "http://ipfs:5001",
        retry_policy=RetryPolicy(max_attempts=3, initial_delay=0.25, max_delay=1),
        sleep=delays.append,
        post=post,
    )

    assert storage.put(b"output") == "ipfs://bafy-output"
    assert attempts == 2
    assert delays == [0.25]


class FakeCall:
    def __init__(self, value=None, transact=None):
        self.value = value
        self._transact = transact

    def call(self):
        return self.value() if callable(self.value) else self.value

    def transact(self):
        if self._transact is not None:
            self._transact()
        return b"tx"


class FakeRegistryFunctions:
    def __init__(self, chain):
        self.chain = chain

    def isEligible(self, _address: str):
        return FakeCall(lambda: self.chain.eligible)


class FakeMarketFunctions:
    def __init__(self, chain):
        self.chain = chain

    def nextJobId(self):
        return FakeCall(2)

    def getJob(self, _job_id: int):
        return FakeCall(("requester", "local://manifest", len(self.chain.tasks)))

    def getTask(self, _job_id: int, index: int):
        return FakeCall(lambda: self.chain.tasks[index])


class FakeVerificationFunctions:
    def __init__(self, chain):
        self.chain = chain

    def hasVoted(self, job_id: int, index: int, _address: str):
        return FakeCall(lambda: (job_id, index) in self.chain.voted)

    def challenge(self, job_id: int, index: int, result_hash: bytes):
        def submit() -> None:
            self.chain.voted.add((job_id, index))
            self.chain.challenges.append((job_id, index, bytes(result_hash)))

        return FakeCall(transact=submit)


class FakeContract:
    def __init__(self, functions):
        self.functions = functions


class FakeChain:
    address = "0xChallenger"

    def __init__(self):
        self.eligible = True
        self.voted = {(1, 3)}
        self.challenges: list[tuple[int, int, bytes]] = []
        other = "0xProvider"
        self.tasks = [
            (other, b"a" * 32, "cid", STATUS_SUBMITTED, 0, 0, 0),
            (self.address, b"b" * 32, "cid", STATUS_SUBMITTED, 0, 0, 0),
            (other, b"c" * 32, "cid", STATUS_OPEN, 0, 0, 0),
            (other, b"d" * 32, "cid", STATUS_SUBMITTED, 0, 0, 0),
            (other, b"e" * 32, "cid", STATUS_SUBMITTED, 0, 0, 0),
        ]
        self.registry = FakeContract(FakeRegistryFunctions(self))
        self.market = FakeContract(FakeMarketFunctions(self))
        self.verification = FakeContract(FakeVerificationFunctions(self))

    def call(self, fn):
        return fn.call()

    def tx(self, fn):
        return fn.transact()


class FakeStorage:
    def get(self, _cid: str) -> bytes:
        return json.dumps({"tasks": [{"index": i} for i in range(5)]}).encode()


class FakeExecutor:
    def __init__(self):
        self.manifests: list[dict] = []

    def run(self, manifest: dict) -> bytes:
        self.manifests.append(manifest)
        return b"recomputed-output"


def test_challenger_samples_eligible_non_self_submissions_once():
    chain = FakeChain()
    executor = FakeExecutor()
    agent = Agent(chain, FakeStorage(), executor)
    samples = iter((0.2, 0.8))

    selected = list(agent.submitted_tasks(0.5, sampler=lambda: next(samples)))
    assert selected == [(1, 0)]
    assert list(
        agent.submitted_tasks(
            0.5,
            sampler=lambda: pytest.fail("submission was sampled more than once"),
        )
    ) == [(1, 0)]

    agent.challenge(1, 0)

    assert executor.manifests == [{"index": 0}]
    assert len(chain.challenges) == 1
    assert list(agent.submitted_tasks(1, sampler=lambda: 0)) == []


def test_ineligible_challenger_does_not_sample_or_execute():
    chain = FakeChain()
    chain.eligible = False
    executor = FakeExecutor()
    agent = Agent(chain, FakeStorage(), executor)

    assert list(
        agent.submitted_tasks(
            1,
            sampler=lambda: pytest.fail("ineligible challenger sampled work"),
        )
    ) == []
    assert executor.manifests == []


def test_claimed_tasks_are_recovered_after_restart():
    chain = FakeChain()
    chain.tasks[2] = (chain.address, b"\0" * 32, "", STATUS_CLAIMED, 0, 0, 0)
    agent = Agent(chain, FakeStorage(), FakeExecutor())

    assert list(agent.claimed_tasks()) == [(1, 2)]
