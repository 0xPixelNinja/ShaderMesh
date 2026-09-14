import json
import os
import subprocess
import sys
import time
import urllib.request

import pytest

HERE = os.path.dirname(__file__)
# Make the flat agent modules (chain, storage, executor, provider, rental, ...) importable.
sys.path.insert(0, HERE)

CONTRACTS = os.path.normpath(os.path.join(HERE, "..", "contracts"))
DEPLOY_FILE = os.path.join(CONTRACTS, "deployments", "localhost.json")
RPC = "http://127.0.0.1:8545"


def rpc_up() -> bool:
    try:
        req = urllib.request.Request(
            RPC,
            data=b'{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
            headers={"content-type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=1).read()
        return True
    except Exception:
        return False


def _kill(proc: subprocess.Popen) -> None:
    if sys.platform == "win32":
        subprocess.run(f"taskkill /F /T /PID {proc.pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        proc.terminate()


@pytest.fixture(scope="session")
def hardhat_node():
    """Ensure a local Hardhat node is running for the whole test session."""
    started = None
    if not rpc_up():
        started = subprocess.Popen(
            "npx hardhat node", cwd=CONTRACTS, shell=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 90
        while time.time() < deadline and not rpc_up():
            time.sleep(1)
        if not rpc_up():
            _kill(started)
            pytest.fail("hardhat node did not start")
    yield RPC
    if started is not None:
        _kill(started)


@pytest.fixture
def deployment(hardhat_node):
    """Deploy a fresh stack for each test and return the deployment descriptor."""
    subprocess.run(
        "npx hardhat run scripts/deploy.ts --network localhost",
        cwd=CONTRACTS, shell=True, check=True,
    )
    with open(DEPLOY_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


# Well known public Hardhat test keys (test only, safe to commit).
KEYS = {
    0: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    3: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
}
