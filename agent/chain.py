"""Thin chain client wrapping web3 and the ShaderMesh contracts.

Loads addresses and ABIs from the deployment file produced by the contracts
deploy script, signs with a provided key so it works on any network (local or
testnet), and exposes typed contract handles plus a transaction helper.
"""

from __future__ import annotations

import json
from typing import Any

from web3 import Web3

try:  # web3 v7
    from web3.middleware import SignAndSendRawMiddlewareBuilder
except ImportError:  # pragma: no cover - fallback for other versions
    SignAndSendRawMiddlewareBuilder = None  # type: ignore


def load_deployment(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class ChainClient:
    def __init__(self, rpc_url: str, deployment: dict, private_key: str):
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
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

    def _contract(self, address: str, abi: Any):
        return self.w3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)

    @property
    def address(self) -> str:
        return self.account.address

    def tx(self, fn) -> Any:
        """Send a contract call as a transaction and wait for the receipt.

        Raises if the transaction reverts.
        """
        tx_hash = fn.transact()
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
        if receipt["status"] != 1:
            raise RuntimeError(f"transaction reverted: {tx_hash.hex()}")
        return receipt
