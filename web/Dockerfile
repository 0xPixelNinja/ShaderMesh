# ShaderMesh dashboard (Next.js).
FROM node:20-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm install

COPY . .
# NEXT_PUBLIC_* are baked at build time. The browser runs on the host, so it
# reaches the published orchestrator and chain ports on localhost.
ENV NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:4000
ENV NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
ENV NEXT_PUBLIC_CHAIN_ID=31337
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
