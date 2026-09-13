import os
import subprocess
import sys

HERE = os.path.dirname(__file__)
JOB_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "jobs", "deterministic"))
RENDER = os.path.join(JOB_DIR, "render.py")
MANIFEST = os.path.join(JOB_DIR, "sample_manifest.json")


def _render(tmp_path, name: str) -> bytes:
    out = os.path.join(str(tmp_path), name)
    subprocess.run([sys.executable, RENDER, MANIFEST, out], check=True, capture_output=True)
    with open(out, "rb") as f:
        return f.read()


def test_output_is_valid_png(tmp_path):
    data = _render(tmp_path, "a.png")
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(data) > 100


def test_output_is_deterministic(tmp_path):
    a = _render(tmp_path, "a.png")
    b = _render(tmp_path, "b.png")
    assert a == b
