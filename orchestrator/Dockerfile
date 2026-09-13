# ShaderMesh orchestrator service.
FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV NODE_ENV=production
EXPOSE 4000

CMD ["npm", "start"]
