# ShaderMesh contracts image.
# Dual purpose: runs the local dev chain (`hardhat node`) and the deploy script.
# Uses Debian slim (glibc) because Hardhat's EDR native addon lacks musl/alpine prebuilds.
FROM node:20-bookworm-slim

WORKDIR /app

# git is occasionally needed by transitive npm deps.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm ci

# Copy sources and pre-compile so artifacts are baked into the image.
COPY . .
RUN npx hardhat compile

EXPOSE 8545

# Default: run a deterministic local chain reachable from other services.
CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0"]
