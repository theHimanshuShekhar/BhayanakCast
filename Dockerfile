# syntax=docker/dockerfile:1

FROM node:26-alpine AS base
# Node 25+ no longer bundles corepack, so install it before enabling pnpm.
RUN npm install -g corepack@latest && corepack enable
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

FROM node:26-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# server.prod.ts runs unbundled on Node's native TypeScript support and imports
# from src/server and src/db; migrations are applied from ./drizzle at start.
COPY package.json server.prod.ts ./
COPY src ./src
COPY drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["sh", "-c", "node src/db/migrate.ts && exec node server.prod.ts"]
