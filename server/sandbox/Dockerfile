FROM node:22-bookworm-slim AS builder

WORKDIR /build

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build && find dist -name '*.spec.js*' -delete


FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /build/dist ./dist

# Docker seeds a fresh named volume from the image path it is mounted over,
# ownership included. Without this the non-root user cannot write to /workspace.
RUN mkdir -p /workspace && chown node:node /workspace

USER node
WORKDIR /workspace

ENTRYPOINT ["node", "/app/dist/main.js"]
