# AGENTS.md - BhayanakCast Developer Guide

Quick reference for developers and AI agents working on this codebase.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Setup environment
cp .env.example .env.local
# Edit .env.local with your Discord OAuth credentials

# 3. Start PostgreSQL
docker compose up -d postgres

# 4. Push database schema
pnpm db:push

# 5. Start development
pnpm dev              # Runs web (3000) + WebSocket (3001)

# 6. Run tests (in another terminal, requires dev server running)
pnpm test             # Auto-creates test DB and runs all tests (unit + E2E)
```

## Commands

### Development
```bash
pnpm dev              # Web (3000) + WebSocket (3001)
pnpm dev:web          # Web only
pnpm dev:ws           # WebSocket only
```

### Testing
```bash
pnpm test             # All tests (unit + integration + E2E, requires PostgreSQL)
pnpm test:unit        # Unit and integration tests only
pnpm test:e2e         # Playwright E2E tests only
pnpm test:watch       # Watch mode (unit tests)
pnpm test:coverage    # With coverage report
pnpm test:e2e:ui      # E2E tests with UI mode
pnpm vitest run path/to/test.ts
```

### Code Quality
```bash
pnpm lint             # Check code style
pnpm format           # Format code
pnpm check            # Run all quality checks (lint + format)
```

### Database
```bash
pnpm db:push          # Push schema changes
pnpm db:studio        # Drizzle Studio
pnpm db:generate      # Generate migrations
pnpm db:migrate       # Run migrations
```

## Tech Stack & Architecture

**Framework:** TanStack Start (React + SSR)  
**Auth:** Better Auth with Discord OAuth  
**Database:** PostgreSQL 16 + Drizzle ORM  
**Real-time:** Socket.io WebSocket server (port 3001)  
**Styling:** Tailwind CSS v4 with custom dark theme  
**Testing:** Vitest v3 + jsdom (205 tests, 90%+ coverage) + Playwright E2E (23 tests)  
**Formatter:** Biome (not Prettier)

### Key Features

🎥 **WebRTC Screen Sharing** - P2P streaming with audio configuration  
🔄 **Automatic Streamer Transfer** - Ownership transfers to earliest viewer  
⏱️ **Watch Time Tracking** - Community statistics and user relationships  
🛡️ **Rate Limiting** - 8 different action types protected  
🎨 **Discord-inspired UI** - Dark theme with depth-based styling  
🔒 **Discord OAuth** - Secure authentication  
🧪 **Comprehensive Testing** - 238 unit/integration + 23 E2E tests  

### Project Stats

- **Tests:** 238 unit/integration + 23 E2E (261 total)
- **Coverage:** 90%+ threshold
- **Rate Limits:** Room create (3/min), Join (10/min), Chat (30/15s), etc.
- **Room States:** 4 lifecycle states (waiting → preparing → active → ended)
- **WebRTC:** P2P screen sharing with 3 audio modes
- **Community Stats:** Single-record upsert pattern (no historical data)

## WebSocket-First Architecture (NEW)

All room operations now go through WebSocket. Database is secondary (persistence layer only).

### Architecture
```
Frontend → WebSocket Server → Database (sync) → Broadcast
              ↓
         In-Memory State (primary)
```

### Key Rules
1. **Frontend NEVER writes to database** - All room operations via WebSocket
2. **Database writes are synchronous** - Wait for confirmation before broadcasting
3. **WebSocket maintains primary state** - In-memory Map is source of truth during runtime
4. **Auto-rejoin on reconnect** - Clients automatically recover after server restart

### New Events
- `room:create` - Create room (replaces HTTP server fn)
- `room:join` - Join room (replaces HTTP server fn)
- `room:leave` - Leave room (replaces HTTP server fn)
- `room:rejoin` - Reconnect after server restart
- `room:state_sync` - Full state for rejoins

### Files
- `websocket/room-state.ts` - In-memory state management
- `websocket/room-events.ts` - Room event handlers
- `websocket/db-persistence.ts` - DB write operations
- `src/hooks/useRoom.ts` - Room state subscription

See [WebSocket Architecture](./docs/WEBSOCKET_ARCHITECTURE.md) for details.

## Coding Standards

### Code Style
- **Indentation:** Tabs (not spaces)
- **Quotes:** Double quotes
- **Formatter:** Biome (not Prettier)
- **No non-null assertions** (`!`)
- **Imports:** Use `#/` alias for src

### Database Rules (⚠️ CRITICAL)

**NEVER import database at the top level of client files.** Database imports use Node.js-only modules that crash the browser.

```typescript
// ✅ CORRECT - Dynamic import inside server function
const myFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const { db } = await import("#/db/index");
    return db.query.users.findMany();
  });

// ❌ WRONG - Will crash browser with "Buffer is not defined"
import { db } from "#/db/index";
```

### Component Patterns

**Data Fetching:** Use React Query, never `useEffect` + `fetch`:
```typescript
const { data } = useQuery({
  queryKey: ["rooms"],
  queryFn: () => getActiveRooms(),
  staleTime: 30 * 60 * 1000, // 30 min
});
```

**Server Functions:** Always use `inputValidator` (not `validator`):
```typescript
const myFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { db } = await import("#/db/index");
    // ... database queries
  });
```

### Styling Guidelines
- **Theme:** Use `bg-depth-0` to `bg-depth-4` (no arbitrary values like `[100px]`)
- **Colors:** `text-accent`, `bg-accent` for theme colors
- **Status:** `text-success`, `text-warning`, `text-danger`, `text-info`
- **Rounded:** Use `rounded-xl` for interactive elements (buttons, cards)

### Testing
```typescript
// Unit test example
import { render, screen } from "@testing-library/react";

describe("RoomCard", () => {
  it("renders room name", () => {
    render(<RoomCard room={mockRoom} />);
    expect(screen.getByText("Test Room")).toBeInTheDocument();
  });
});
```

See [Testing Guide](./docs/TESTING.md) for detailed documentation.

## Project Structure

```
src/
├── components/           # UI components (RoomCard, Chat, Header, etc.)
│   ├── AudioConfigModal.tsx
│   ├── StreamerControls.tsx
│   └── ...
├── db/                  # Database layer (SERVER-ONLY)
│   ├── schema.ts        # Drizzle ORM table definitions
│   └── queries/         # Query functions (stats, etc.)
├── hooks/               # React hooks
│   └── useWebRTC.ts     # WebRTC streaming hook
├── lib/                 # Core utilities
│   ├── auth.ts          # Better Auth configuration
│   ├── device-detection.ts  # Mobile/desktop detection
│   ├── rate-limiter.ts  # Rate limiting system
│   ├── profanity-filter.ts
│   ├── webrtc-config.ts # WebRTC configuration
│   └── websocket-context.tsx
├── routes/              # TanStack Router file-based routes
│   ├── index.tsx        # Home page
│   ├── room.$roomId.tsx
│   └── api/             # API routes
├── types/               # TypeScript types
│   └── webrtc.ts        # WebRTC type definitions
├── utils/               # Server utility functions
│   ├── rooms.ts         # Room CRUD operations
│   ├── home.ts          # Home page data
│   └── websocket-client.ts
└── styles.css           # Global styles with theme system

websocket/               # WebSocket server (separate process)
├── websocket-server.ts
├── websocket-room-manager.ts
├── room-state.ts        # ⭐ In-memory state management (NEW)
├── room-events.ts       # ⭐ Room event handlers (NEW)
└── db-persistence.ts    # ⭐ Database persistence (NEW)

tests/                   # Test files
├── unit/                # Unit tests
│   └── webrtc/          # WebRTC tests (47 tests)
├── integration/         # Integration tests
│   └── webrtc/          # WebRTC integration tests
├── fixtures/            # Test data
└── utils/               # Test utilities

e2e/                     # E2E tests (Playwright)
├── fixtures/
├── tests/
│   ├── room-management.spec.ts
│   ├── screen-sharing.spec.ts
│   ├── streamer-transfer.spec.ts
│   └── chat.spec.ts
└── README.md

docs/                    # Documentation (see below)
```

## Room System Business Logic

### Room Status States
- **waiting:** Room created, no streamer (gray indicator)
- **preparing:** Streamer present, < 2 viewers (yellow indicator)
- **active:** Live streaming, 2+ participants (green "LIVE" indicator)
- **ended:** Room closed (history icon, visible for 3 hours)

### Streamer Departure
1. Streamer leaves → earliest viewer auto-becomes streamer
2. No viewers → streamerId = null, status = waiting
3. Transfer is automatic (no acceptance needed)
4. **Cooldown:** 30 seconds between transfers

### Joining Rules
- User can only be in ONE room at a time
- Joining waiting room → auto-becomes streamer
- 2nd participant joins → room becomes active

### Cleanup
- Waiting rooms empty for 5 min → status = ended
- Ended rooms visible for 3 hours in "Past Streams"
- Cleanup job runs every minute

## Environment Variables

Required in `.env.local`:
```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"

# Auth
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate: pnpm dlx @better-auth/cli secret>

# Discord OAuth
DISCORD_CLIENT_ID=<discord_app_id>
DISCORD_CLIENT_SECRET=<discord_secret>

# WebSocket
VITE_WS_URL=http://localhost:3001
```

See [Environment Variables](./docs/ENVIRONMENT_VARIABLES.md) for complete guide.

## Key Files

- **Auth config:** `src/lib/auth.ts` (usePlural: true REQUIRED)
- **WebSocket server:** `websocket/websocket-server.ts`
- **Database schema:** `src/db/schema.ts`
- **Stats queries:** `src/db/queries/stats.ts`
- **Rate limiter:** `src/lib/rate-limiter.ts`
- **Room utilities:** `src/utils/rooms.ts`
- **WebRTC hook:** `src/hooks/useWebRTC.ts`
- **Device detection:** `src/lib/device-detection.ts`
- **WebRTC config:** `src/lib/webrtc-config.ts`

## Documentation Index

All detailed documentation is in the `/docs` directory:

### Getting Started
- [Getting Started](./docs/GETTING_STARTED.md) - Detailed setup instructions
- [Environment Variables](./docs/ENVIRONMENT_VARIABLES.md) - Complete configuration guide

### Technical Reference
- [Database Schema](./docs/DATABASE_SCHEMA.md) - Table definitions and relationships
- [Room System](./docs/ROOM_SYSTEM.md) - Room lifecycle and business logic
- [WebSocket Events](./docs/WEBSOCKET_EVENTS.md) - Socket.io events reference
- [WebSocket Architecture](./docs/WEBSOCKET_ARCHITECTURE.md) - WebSocket-first architecture guide ⭐ NEW
- [Rate Limiting](./docs/RATE_LIMITING.md) - Rate limit configurations
- [WebRTC Documentation](./docs/webrtc/) - WebRTC implementation guide (8 files)

### Development Guides
- [Project Structure](./docs/PROJECT_STRUCTURE.md) - Directory organization
- [Coding Standards](./docs/CODING_STANDARDS.md) - Code style and rules
- [Testing Guide](./docs/TESTING.md) - Testing framework and best practices
- [Integration Test Limitations](./docs/INTEGRATION_TEST_LIMITATIONS.md) - Why some tests are skipped

### Planning
- [PLAN.md](./PLAN.md) - Roadmap, completed features, and future plans

## Git Commits

- **Never commit without explicit request**
- Only commit when user asks (e.g., "commit changes")
- OK to stage with `git add`, but don't commit unless requested

## External References

- [Socket.io Docs](https://socket.io/docs/)
- [TanStack Start](https://tanstack.com/start/latest)
- [Drizzle ORM](https://orm.drizzle.team)
- [Better Auth](https://www.better-auth.com)

---

*For detailed information on any topic, see the individual docs in the `/docs` directory.*
