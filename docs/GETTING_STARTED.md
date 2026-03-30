# Getting Started

## Prerequisites

- Node.js 20+ with pnpm
- PostgreSQL 16+ (via Docker)
- Discord OAuth app

## Setup

```bash
git clone <repo-url>
cd BhayanakCast
pnpm install
cp .env.example .env.local
# Fill in .env.local — see ENVIRONMENT_VARIABLES.md
```

### Discord OAuth App
1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create app → OAuth2 → copy Client ID and Secret
3. Add redirect URI: `http://localhost:3000/api/auth/callback/discord`

### Auth Secret
```bash
pnpm dlx @better-auth/cli secret
# Copy output to BETTER_AUTH_SECRET in .env.local
```

### Database
```bash
docker compose up -d postgres
pnpm db:push
```

## Development

```bash
pnpm dev          # Web (port 3000) + WebSocket (port 3001) concurrently
pnpm dev:web      # Web only
pnpm dev:ws       # WebSocket only
```

## Commands Reference

```bash
# Testing
pnpm test:unit      # 373 Vitest tests
pnpm test:watch     # Watch mode
pnpm test:coverage  # Coverage (90% threshold)
pnpm test:e2e       # Playwright E2E (requires dev server running)

# Code quality
pnpm check          # Biome lint + format check
pnpm format         # Auto-fix formatting
pnpm lint           # Lint only

# Database
pnpm db:push        # Push schema (dev)
pnpm db:generate    # Generate migration files
pnpm db:migrate     # Run migrations
pnpm db:studio      # Drizzle Studio UI
```

**E2E tests are NOT run in CI.** Run locally before major releases.

## Docker

```bash
docker compose build
docker compose up -d      # Includes PostgreSQL
docker compose logs -f
docker compose down
```

App available at http://localhost:3000 (web) and http://localhost:3001 (WebSocket).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| PostgreSQL connection failed | `docker ps` — ensure container running; check `DATABASE_URL` |
| WebSocket connection failed | Ensure `pnpm dev:ws` is running; check `VITE_WS_URL` |
| DB schema out of sync | `pnpm db:push` |
| Auth not working | Check `BETTER_AUTH_SECRET` is set and `BETTER_AUTH_URL` matches domain |

## See Also
- [Environment Variables](./ENVIRONMENT_VARIABLES.md)
- [Project Structure](./PROJECT_STRUCTURE.md)
- [Coding Standards](./CODING_STANDARDS.md)
