# Deterministic job: Mandelbrot tile renderer

The "deterministic first" workload. It renders one image region (tile) to a PNG
using only the Python standard library, so output is byte reproducible for a
given manifest on a given machine. This makes the verification game exact hash
verifiable before Blender rendering (which is only perceptually reproducible)
is introduced in Phase 7.

## Run locally

```powershell
python render.py sample_manifest.json out.png
```

## Run as a container

```bash
docker build -t shadermesh/job-deterministic .
docker run --rm -v ${PWD}:/out shadermesh/job-deterministic /out/sample_manifest.json /out/out.png
```

## Manifest

| Field | Meaning |
|-------|---------|
| width, height | pixel size of this tile |
| re_min, re_max | real axis bounds |
| im_min, im_max | imaginary axis bounds |
| max_iter | escape iteration limit |

A job splits a full image into many regions; each task renders one region and the
orchestrator stitches them back together.
