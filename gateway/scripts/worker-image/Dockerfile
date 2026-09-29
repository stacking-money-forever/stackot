# Trusted dependency-only context. No source checkout, auth home or secrets.
FROM node:24.21.0-bookworm-slim AS dependencies
WORKDIR /opt/stackot
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund

# Keep only PATH in image metadata; the owner supplies a task-scoped HOME.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /usr/local /usr/local
COPY --from=dependencies /opt/stackot /opt/stackot
ENV PATH=/opt/stackot/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
