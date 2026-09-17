#!/usr/bin/env python3
"""Report provider hardware and local service availability as public-safe JSON."""

from __future__ import annotations

import csv
import json
import os
import platform
import subprocess
import urllib.error
import urllib.request
from io import StringIO
from typing import Callable


def parse_nvidia_smi(output: str) -> list[dict[str, object]]:
    """Parse name, memory.total, and driver_version CSV output."""
    gpus: list[dict[str, object]] = []
    for row in csv.reader(StringIO(output)):
        if not row or all(not value.strip() for value in row):
            continue
        if len(row) != 3:
            raise ValueError("unexpected nvidia-smi output")
        model, memory_mib, driver = (value.strip() for value in row)
        try:
            vram_mib = int(float(memory_mib.split()[0]))
        except ValueError as exc:
            raise ValueError("invalid NVIDIA memory value") from exc
        gpus.append(
            {
                "model": model,
                "vramMiB": vram_mib,
                "vramGiB": round(vram_mib / 1024, 2),
                "driver": driver,
            }
        )
    return gpus


def _run(command: list[str], timeout: float = 5) -> str | None:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            check=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip()


def _cpu_model() -> str:
    model = platform.processor().strip() or os.environ.get("PROCESSOR_IDENTIFIER", "").strip()
    if model:
        return model
    try:
        with open("/proc/cpuinfo", encoding="utf-8") as cpuinfo:
            for line in cpuinfo:
                if line.lower().startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return "unknown"


def _ram_bytes() -> int | None:
    if os.name == "nt":
        try:
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("length", ctypes.c_ulong),
                    ("memory_load", ctypes.c_ulong),
                    ("total_physical", ctypes.c_ulonglong),
                    ("available_physical", ctypes.c_ulonglong),
                    ("total_page_file", ctypes.c_ulonglong),
                    ("available_page_file", ctypes.c_ulonglong),
                    ("total_virtual", ctypes.c_ulonglong),
                    ("available_virtual", ctypes.c_ulonglong),
                    ("available_extended_virtual", ctypes.c_ulonglong),
                ]

            status = MemoryStatus()
            status.length = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.total_physical)
        except (AttributeError, OSError):
            return None
    try:
        return int(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES"))
    except (AttributeError, OSError, ValueError):
        return None


def _ollama_version(
    url: str,
    opener: Callable[..., object] = urllib.request.urlopen,
) -> str | None:
    try:
        response = opener(f"{url.rstrip('/')}/api/version", timeout=3)
        with response:  # type: ignore[attr-defined]
            payload = json.loads(response.read())  # type: ignore[attr-defined]
        version = payload.get("version")
        return version if isinstance(version, str) else None
    except (OSError, ValueError, urllib.error.URLError):
        return None


def discover() -> dict[str, object]:
    nvidia_output = _run(
        [
            "nvidia-smi",
            "--query-gpu=name,memory.total,driver_version",
            "--format=csv,noheader,nounits",
        ]
    )
    try:
        gpus = parse_nvidia_smi(nvidia_output) if nvidia_output else []
    except ValueError:
        gpus = []

    docker_version = _run(["docker", "version", "--format", "{{.Server.Version}}"])
    ollama_version = _ollama_version(
        os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    )
    ram_bytes = _ram_bytes()
    return {
        "os": {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "architecture": platform.machine(),
        },
        "cpu": {"model": _cpu_model(), "logicalCores": os.cpu_count()},
        "ram": {
            "bytes": ram_bytes,
            "gib": round(ram_bytes / 1024**3, 2) if ram_bytes is not None else None,
        },
        "nvidia": {"available": bool(gpus), "gpus": gpus},
        "docker": {"available": docker_version is not None, "version": docker_version},
        "ollama": {"available": ollama_version is not None, "version": ollama_version},
    }


def main() -> None:
    print(json.dumps(discover(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
