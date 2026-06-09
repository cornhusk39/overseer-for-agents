# Single image that builds the whole workspace and can run either service. The
# compose file starts it twice with different commands (ingest, then web), which
# keeps the build cached and the image set to one. Self-host is the v1 target, so
# simplicity here is the point.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
# Build tools in case better-sqlite3 has to compile its native addon (it usually
# downloads a prebuilt binary, but this makes the build robust either way).
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
# Default command is the ingest service; the web service overrides it in compose.
CMD ["node", "packages/ingest/dist/server-main.js"]
