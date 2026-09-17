"""Tests for the standard-library hardware discovery parsers."""

from __future__ import annotations

import json

import pytest

from discover_hardware import _ollama_version, parse_nvidia_smi


def test_parse_nvidia_smi_multiple_gpus():
    output = (
        "NVIDIA GeForce RTX 4090, 24564, 560.94\n"
        "NVIDIA RTX A2000, 6144 MiB, 552.12\n"
    )

    assert parse_nvidia_smi(output) == [
        {
            "model": "NVIDIA GeForce RTX 4090",
            "vramMiB": 24564,
            "vramGiB": 23.99,
            "driver": "560.94",
        },
        {
            "model": "NVIDIA RTX A2000",
            "vramMiB": 6144,
            "vramGiB": 6.0,
            "driver": "552.12",
        },
    ]


def test_parse_nvidia_smi_rejects_unknown_shape():
    with pytest.raises(ValueError, match="unexpected"):
        parse_nvidia_smi("NVIDIA GPU, 8192")


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self) -> bytes:
        return json.dumps({"version": "0.11.0"}).encode()


def test_ollama_version_parser_does_not_expose_url():
    requested: list[str] = []

    def open_url(url: str, timeout: int):
        requested.append(url)
        assert timeout == 3
        return FakeResponse()

    assert _ollama_version("http://localhost:11434/", open_url) == "0.11.0"
    assert requested == ["http://localhost:11434/api/version"]
