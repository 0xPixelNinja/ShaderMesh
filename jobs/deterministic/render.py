#!/usr/bin/env python3
"""
ShaderMesh deterministic job: Mandelbrot tile renderer.

Given a manifest describing an image region, this produces a PNG using only the
Python standard library, so it has no third party dependencies and yields
byte reproducible output for a given input on a given machine. It is the
"deterministic first" workload used to make the verification game exact hash
verifiable before Blender rendering is introduced.

A single task renders one tile or region. A job is split into many such regions.

Usage:
    python render.py <manifest.json> <output.png>

Manifest fields:
    width, height        output pixel size of this tile
    re_min, re_max       real axis bounds of the region
    im_min, im_max       imaginary axis bounds of the region
    max_iter             escape iteration limit
"""

from __future__ import annotations

import json
import struct
import sys
import zlib


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_png(width: int, height: int, rows: list[bytes]) -> bytes:
    """Encode 8-bit truecolor (RGB) rows into PNG bytes."""
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type 0 (none)
        raw.extend(row)
    idat = zlib.compress(bytes(raw), 9)
    return signature + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def _color(n: int, max_iter: int) -> tuple[int, int, int]:
    if n >= max_iter:
        return (0, 0, 0)
    t = n / max_iter
    r = int(9 * (1 - t) * t * t * t * 255)
    g = int(15 * (1 - t) * (1 - t) * t * t * 255)
    b = int(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255)
    return (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))


def render_png(manifest: dict) -> bytes:
    width = int(manifest["width"])
    height = int(manifest["height"])
    re_min = float(manifest["re_min"])
    re_max = float(manifest["re_max"])
    im_min = float(manifest["im_min"])
    im_max = float(manifest["im_max"])
    max_iter = int(manifest["max_iter"])

    dre = (re_max - re_min) / width
    dim = (im_max - im_min) / height

    rows: list[bytes] = []
    for py in range(height):
        c_im = im_min + py * dim
        row = bytearray()
        for px in range(width):
            c_re = re_min + px * dre
            zr = 0.0
            zi = 0.0
            n = 0
            while n < max_iter and (zr * zr + zi * zi) <= 4.0:
                zr, zi = zr * zr - zi * zi + c_re, 2.0 * zr * zi + c_im
                n += 1
            r, g, b = _color(n, max_iter)
            row.append(r)
            row.append(g)
            row.append(b)
        rows.append(bytes(row))

    return encode_png(width, height, rows)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: python render.py <manifest.json> <output.png>", file=sys.stderr)
        return 2
    manifest = json.loads(open(argv[1], "r", encoding="utf-8").read())
    data = render_png(manifest)
    with open(argv[2], "wb") as f:
        f.write(data)
    print(f"wrote {argv[2]} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
