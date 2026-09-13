# ShaderMesh provider compute agent.
# NOTE: to execute jobs the agent talks to the Docker daemon via the mounted
# socket (/var/run/docker.sock). It launches sibling containers (e.g. Blender);
# it does NOT run Docker-in-Docker.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Unbuffered logs for compose.
ENV PYTHONUNBUFFERED=1

CMD ["python", "agent.py"]
