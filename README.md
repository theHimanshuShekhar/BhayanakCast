# BhayanakCast

BhayanakCast is a TanStack Start watch-together app for small public/private rooms, WebRTC screen streams, Discord authentication, and aggregate-backed profile/admin views.

## Runtime services

The app requires PostgreSQL and Valkey. Start local services with:

```bash
docker compose up -d postgres valkey
```

Required environment variables are documented in `docs/configuration.md`; the minimum local set is:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bhayanakcast
VALKEY_URL=redis://127.0.0.1:6379
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<32+ chars>
DISCORD_CLIENT_ID=<discord app id>
DISCORD_CLIENT_SECRET=<discord secret>
```

## Setup

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

## Quality gates

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
pnpm lint
pnpm check
pnpm test:e2e
```

## Product docs

- `CONTEXT.md` — project overview.
- `docs/routes.md` — route contract.
- `docs/socket-events.md` — Socket.IO protocol.
- `docs/adr/` — accepted architecture decisions.
- `docs/design/prototype/` — reference prototype.
