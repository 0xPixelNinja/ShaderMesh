# Deterministic ShaderMesh job: Mandelbrot tile renderer.
# Pure standard library, so the image is tiny and output is reproducible.
FROM python:3.11-slim

WORKDIR /job
COPY render.py .

# Run as: docker run --rm -v <in>:/in:ro -v <out>:/out job /in/manifest.json /out/output.png
ENTRYPOINT ["python", "render.py"]
