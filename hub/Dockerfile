# ConsoleGate Hub — runs on any always-on machine via Docker (Windows/Mac/Linux).
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# App source.
COPY tsconfig.json ./
COPY src ./src
COPY mock-agent ./mock-agent
COPY web ./web
COPY consolegate.example.yml ./

ENV CG_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8088/tcp
EXPOSE 8099/udp

# The Hub is run directly with tsx (TypeScript executed at runtime).
CMD ["npx", "tsx", "src/index.ts"]
