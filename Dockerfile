# syntax=docker/dockerfile:1

# Reproducible build: the base is pinned by digest (the tag stays for readers; Docker resolves the
# digest) and corepack by exact version. pnpm comes from package.json `packageManager`, which is
# exact too. To bump, see docs/deploy.md ("Pinned images"); Dependabot opens PRs for the digest.
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS base
# Node 25+ no longer bundles corepack, so install it before enabling pnpm.
RUN npm install -g corepack@0.36.0 && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install

FROM base AS deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

FROM deps AS build
COPY . .
RUN pnpm build

# Same digest as `base` above; bump both together.
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# server.prod.ts runs unbundled on Node's native TypeScript support and imports
# from src/server and src/db. migrate.ts validates the whole environment, then applies migrations
# from ./drizzle, so a bad environment stops the container before the schema changes. CI boots this
# same command (scripts/smoke-boot.sh); keep it the same as docker-compose.yml's `command`.
COPY package.json server.prod.ts ./
COPY src ./src
COPY drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["sh", "-c", "node src/db/migrate.ts && exec node server.prod.ts"]
