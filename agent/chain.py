"""Thin chain client wrapping web3 and the ShaderMesh contracts.

Loads addresses and ABIs from the deployment file produced by the contracts
deploy script, signs with a provided key so it works on any network (local or
testnet), and exposes typed contract handles plus a transaction helper.
"""

from __future__ import annotations

import json
import time
from typing import Any

from web3 import Web3

from retry import RetryPolicy, retry_call

try:  # web3 v7
    from web3.middleware import SignAndSendRawMiddlewareBuilder
except ImportError:  # pragma: no cover - fallback for other versions
    SignAndSendRawMiddlewareBuilder = None  # type: ignore


def load_deployment(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def is_transient_rpc_error(exc: Exception) -> bool:
    """Return whether an RPC failure is safe to retry."""
    names = {cls.__name__ for cls in type(exc).__mro__}
    if names & {
        "ContractLogicError",
        "ContractCustomError",
        "ContractPanicError",
        "TransactionFailed",
    }:
        return False

    message = str(exc).lower()
    if "revert" in message or "invalid opcode" in message:
        return False

    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if status is not None:
        return status in (408, 425, 429) or 500 <= status < 600

    if names & {
        "Timeout",
        "ConnectTimeout",
        "ReadTimeout",
        "ConnectionError",
        "TimeExhausted",
    }:
        return True
    return any(
        marker in message
        for marker in (
            "timed out",
            "timeout",
            "connection refused",
            "connection reset",
            "temporarily unavailable",
            "service unavailable",
            "bad gateway",
            "gateway timeout",
            "rate limit",
            "too many requests",
        )
    )


class ChainClient:
    def __init__(
        self,
        rpc_url: str,
        deployment: dict,
        private_key: str,
        *,
        retry_policy: RetryPolicy | None = None,
        sleep=time.sleep,
    ):
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.retry_policy = retry_policy or RetryPolicy()
        self.sleep = sleep
        self.account = self.w3.eth.account.from_key(private_key)
        if SignAndSendRawMiddlewareBuilder is not None:
            self.w3.middleware_onion.inject(
                SignAndSendRawMiddlewareBuilder.build(self.account), layer=0
            )
        self.w3.eth.default_account = self.account.address

        contracts = deployment["contracts"]
        abis = deployment["abis"]
        self.token = self._contract(contracts["SmeshToken"], abis["SmeshToken"])
        self.registry = self._contract(contracts["ProviderRegistry"], abis["ProviderRegistry"])
        self.market = self._contract(contracts["JobMarket"], abis["JobMarket"])
        self.verification = self._contract(contracts["Verification"], abis["Verification"])
        # RentalMarket is the primary market; present in current deployments.
        if "RentalMarket" in contracts:
            self.rental = self._contract(contracts["RentalMarket"], abis["RentalMarket"])
        else:
            self.rental = None
        if "InferenceMarket" in contracts:
            self.inference = self._contract(
                contracts["InferenceMarket"], abis["InferenceMarket"]
            )
        else:
            self.inference = None

    @classmethod
    def from_unlocked_account(
        cls,
        rpc_url: str,
        deployment: dict,
        account_index: int,
        *,
        retry_policy: RetryPolicy | None = None,
        sleep=time.sleep,
    ) -> "ChainClient":
        """Connect as an RPC-unlocked account for local development and tests."""
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        accounts = w3.eth.accounts
        if account_index < 0 or account_index >= len(accounts):
            raise ValueError(f"unlocked account {account_index} is unavailable")

        client = cls.__new__(cls)
        client.w3 = w3
        client.retry_policy = retry_policy or RetryPolicy()
        client.sleep = sleep
        client.account = None
        client.w3.eth.default_account = accounts[account_index]
        contracts = deployment["contracts"]
        abis = deployment["abis"]
        client.token = client._contract(contracts["SmeshToken"], abis["SmeshToken"])
        client.registry = client._contract(
            contracts["ProviderRegistry"], abis["ProviderRegistry"]
        )
        client.market = client._contract(contracts["JobMarket"], abis["JobMarket"])
        client.verification = client._contract(
            contracts["Verification"], abis["Verification"]
        )
        if "RentalMarket" in contracts:
            client.rental = client._contract(
                contracts["RentalMarket"], abis["RentalMarket"]
            )
        else:
            client.rental = None
        if "InferenceMarket" in contracts:
            client.inference = client._contract(
                contracts["InferenceMarket"], abis["InferenceMarket"]
            )
        else:
            client.inference = None
        return client

    def _contract(self, address: str, abi: Any):
        return self.w3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)

    @property
    def address(self) -> str:
        return self.w3.eth.default_account

    def call(self, fn) -> Any:
        """Call a contract view with retry for transient RPC failures."""
        return retry_call(
            fn.call,
            policy=self.retry_policy,
            is_retryable=is_transient_rpc_error,
            sleep=self.sleep,
        )

    def rpc(self, operation) -> Any:
        """Run a read-only RPC operation with retry for transient failures."""
        return retry_call(
            operation,
            policy=self.retry_policy,
            is_retryable=is_transient_rpc_error,
            sleep=self.sleep,
        )

    def tx(self, fn) -> Any:
        """Send a contract call as a transaction and wait for the receipt.

        Raises if the transaction reverts.
        """
        tx_hash = retry_call(
            fn.transact,
            policy=self.retry_policy,
            is_retryable=is_transient_rpc_error,
            sleep=self.sleep,
        )
        receipt = retry_call(
            lambda: self.w3.eth.wait_for_transaction_receipt(tx_hash),
            policy=self.retry_policy,
            is_retryable=is_transient_rpc_error,
            sleep=self.sleep,
        )
        if receipt["status"] != 1:
            raise RuntimeError(f"transaction reverted: {tx_hash.hex()}")
        return receipt

    def ensure_provider_ready(
        self,
        capabilities: str,
        stake_amount: int,
        *,
        auto_faucet: bool = True,
    ) -> bool:
        """Register and reach the configured stake target, using the test faucet if needed."""
        provider = self.call(self.registry.functions.providers(self.address))
        if not provider[0]:
            self.tx(self.registry.functions.register(capabilities))
            provider = self.call(self.registry.functions.providers(self.address))
        else:
            if provider[7] != capabilities:
                self.tx(self.registry.functions.updateCapabilities(capabilities))
            if not provider[1]:
                self.tx(self.registry.functions.setActive(True))
            provider = self.call(self.registry.functions.providers(self.address))

        min_stake = int(self.call(self.registry.functions.minStake()))
        target_stake = max(min_stake, stake_amount)
        required = target_stake - int(provider[2])
        if required <= 0:
            return False

        balance = int(self.call(self.token.functions.balanceOf(self.address)))
        faucet_used = False
        faucet_error: Exception | None = None
        if balance < required and auto_faucet:
            try:
                self.tx(self.token.functions.faucet())
                faucet_used = True
            except Exception as exc:
                faucet_error = exc
            balance = int(self.call(self.token.functions.balanceOf(self.address)))

        if balance < required:
            message = (
                f"provider needs {required} SMESH base units to stake but has {balance}"
            )
            if faucet_error is not None:
                raise RuntimeError(f"{message}; faucet claim failed") from faucet_error
            raise RuntimeError(message)

        self.tx(self.token.functions.approve(self.registry.address, required))
        self.tx(self.registry.functions.stake(required))
        return faucet_used
