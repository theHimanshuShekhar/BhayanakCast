# BhayanakCast Knowledge Base

## Overview
Real-time streaming platform built with TanStack Start, featuring Discord OAuth, Socket.io rooms, and PostgreSQL.

## Tech Stack
- **Framework**: TanStack Start (React + SSR)
- **Auth**: Better Auth with Discord OAuth
- **Database**: PostgreSQL + Drizzle ORM
- **Real-time**: Socket.io WebSocket server (port 3001)
- **Styling**: Tailwind CSS v4 with custom dark theme
- **Icons**: Lucide React

## Quick Start

```bash
# Development
pnpm dev              # Runs both web (3000) and websocket (3001)
pnpm dev:web          # Web only
pnpm dev:ws           # WebSocket only

# Testing
pnpm test             # Run all tests (requires PostgreSQL)
pnpm test:setup       # Create test database

# Database
pnpm db:push          # Push schema changes
pnpm db:studio        # Drizzle Studio

# Code quality
pnpm lint
pnpm format
pnpm check
```

## Project Structure

```
src/
├── components/      # UI components (Header, RoomCard, Chat, etc.)
├── db/             # Database layer (SERVER-ONLY)
│   ├── schema.ts   # Drizzle ORM schema
│   └── queries/    # Query functions
├── lib/            # Core utilities
│   ├── auth.ts     # Better Auth config
│   └── websocket-context.tsx
├── routes/         # TanStack Router file-based routes
│   ├── index.tsx   # Home page
│   ├── room.$roomId.tsx
│   └── auth/$authView.tsx
├── utils/          # Server utility functions
└── styles.css      # Global styles with theme

websocket/          # WebSocket server files
├── websocket-server.ts
└── websocket-room-manager.ts
```

## Critical Rules

### Database Usage
⚠️ **Database imports ONLY in server functions:**
```typescript
// ✅ CORRECT - Dynamic import inside server function
const myFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const { db } = await import("#/db/index");
    return db.query.users.findMany();
  });

// ❌ WRONG - Will cause Buffer error in browser
import { db } from "#/db/index";  // Never at top level of client files
```

### Code Style
- **Indentation**: Tabs (Biome)
- **Quotes**: Double
- **Formatter**: Biome (not Prettier)
- **Imports**: Use `#/` alias for src
- **Types**: Strict mode, no non-null assertions
- **Theme**: Use `bg-depth-0` to `bg-depth-4`, never arbitrary Tailwind values

## Database Schema

### Better Auth Tables
- `users` - Discord OAuth users (auto-synced on login)
- `sessions`, `accounts`, `verifications`

### Application Tables
- `streaming_rooms` - Rooms (status: waiting/preparing/active/ended, streamerId nullable)
- `room_participants` - Room join/leave tracking with watch time
- `user_relationships` - Aggregated time between users
- `user_room_overlaps` - Detailed overlap tracking

## Room System

### Status States
| Status | Description | Indicator |
|--------|-------------|-----------|
| `waiting` | No streamer | Gray dot |
| `preparing` | Streamer only | Yellow dot |
| `active` | Streaming | Green dot + "LIVE" |
| `ended` | Closed | History icon |

### Business Logic
- **Streamer leaves** → earliest viewer auto-becomes streamer
- **No viewers** → streamerId = null, status = waiting
- **Waiting + 5 min empty** → status = ended (cleanup job)
- **User can only be in ONE room** at a time

### Socket.io Events

**Client → Server:**
- `room:join` / `room:leave` - Join/leave room
- `chat:send` - Send chat message
- `streamer:transfer` - Transfer ownership (30s cooldown)

**Server → Client:**
- `room:user_joined` / `room:user_left`
- `room:streamer_changed`
- `room:status_changed`
- `chat:message` (user or system)

## Environment Variables

```bash
# Required
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate: pnpm dlx @better-auth/cli secret>
DISCORD_CLIENT_ID=<from Discord Developer Portal>
DISCORD_CLIENT_SECRET=<from Discord Developer Portal>

# WebSocket
VITE_WS_URL=http://localhost:3001
CLIENT_URL=http://localhost:3000

# Optional
VITE_POSTHOG_KEY=<optional>
```

## Testing

**Framework**: Vitest v3 + jsdom
**Total Tests**: 59
**Coverage**: 90%+ threshold

```bash
pnpm test:setup       # One-time setup
pnpm test             # Run all tests
pnpm vitest run tests/unit/RoomCard.test.tsx
```

**Test Database**: `bhayanak_cast_test` (isolated, cleared before each test)

## References

- [Socket.io Docs](https://socket.io/docs/)
- [TanStack Start](https://tanstack.com/start/latest)
- [Drizzle ORM](https://orm.drizzle.team)
- [Better Auth](https://www.better-auth.com)
- [PLAN.md](./PLAN.md) - Roadmap and features
