ARG BUILDPLATFORM
ARG TARGETPLATFORM

# -- Builder -----------------------------------------------------------
FROM node:22-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS builder

WORKDIR /app

# Build gitnexus-shared first
COPY gitnexus-shared/package.json gitnexus-shared/package-lock.json ./gitnexus-shared/
RUN npm ci --prefix gitnexus-shared
COPY gitnexus-shared ./gitnexus-shared
RUN rm -f gitnexus-shared/tsconfig.tsbuildinfo
RUN npm run build --prefix gitnexus-shared

# Copy the full gitnexus package and install (skip all scripts to avoid
# tree-sitter-dart / tree-sitter-proto native compilation — they are
# optional dependencies and gracefully degrade at runtime if absent).
COPY gitnexus ./gitnexus
RUN npm ci --prefix gitnexus --ignore-scripts

# Build TypeScript and rewrite gitnexus-shared imports.
RUN node gitnexus/scripts/build.js

# Drop dev dependencies for a smaller runtime layer.
RUN npm prune --omit=dev --prefix gitnexus

# -- Runtime -----------------------------------------------------------
FROM node:22-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS runtime

# curl (debug), git (repo clone), ca-certificates (TLS).
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -rf /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /app

# Pre-create the data directory for the unprivileged `node` user.
RUN mkdir -p /data/gitnexus && chown -R node:node /data

COPY --from=builder --chown=node:node /app/gitnexus/dist        ./gitnexus/dist
COPY --from=builder --chown=node:node /app/gitnexus/node_modules ./gitnexus/node_modules
COPY --from=builder --chown=node:node /app/gitnexus/package.json ./gitnexus/package.json
COPY --from=builder --chown=node:node /app/gitnexus/scripts/install-duckdb-extension.mjs ./gitnexus/scripts/install-duckdb-extension.mjs
COPY --from=builder --chown=node:node /app/gitnexus/vendor/leiden ./gitnexus/vendor/leiden

# Expose gitnexus binary on PATH.
RUN ln -s /app/gitnexus/dist/cli/index.js /usr/local/bin/gitnexus

USER node

ENV GITNEXUS_HOME=/data/gitnexus \
    NODE_ENV=production

ENTRYPOINT ["gitnexus"]
CMD ["--help"]
