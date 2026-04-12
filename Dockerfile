# ──────────────────────────────────────────────
# Marinara Engine — Multi-stage Docker Build
# ──────────────────────────────────────────────

# ── Stage 1: Build ──
FROM node:22-slim AS builder
ARG PNPM_VERSION=10.30.3
ARG BUILD_COMMIT
WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy workspace config first (layer cache for deps)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# Install all dependencies (including dev for building)
# Use cache mount to avoid storing pnpm store in image
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/

# Build everything: shared → server + client in parallel
# Increase heap for ARM64 emulation (QEMU) where memory pressure is high
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm build

# Bake the git commit into build-meta.json so the app can display it.
# __dirname in build-info.js resolves to packages/server/dist/config/
RUN if [ -n "$BUILD_COMMIT" ]; then \
      echo "{\"commit\":\"$BUILD_COMMIT\"}" > packages/server/dist/config/build-meta.json; \
    fi

# ── Stage 2: Production ──
FROM node:22-slim AS production
ARG PNPM_VERSION=10.30.3
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# Install production deps only
# Use cache mount to avoid storing pnpm store in image
# Strip onnxruntime-web WASM blobs, uses onnxruntime-node (native)
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod && \
    rm -rf /app/node_modules/.pnpm/onnxruntime-web@*

# Copy built artifacts from builder
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/client/dist packages/client/dist

# Ensure /app/data exists for runtime use (fonts, default backgrounds, db, uploads)
RUN mkdir -p /app/data

# Point the server at /app/data regardless of working directory
ENV DATA_DIR=/app/data

# The SQLite database + user uploads live in /app/data at runtime.
# Mount a volume here for persistence.
VOLUME /app/data

# Default port
ENV PORT=7860
ENV HOST=0.0.0.0
ENV NODE_ENV=production
EXPOSE 7860

# Run the server (serves both API and client SPA)
CMD ["node", "packages/server/dist/index.js"]
