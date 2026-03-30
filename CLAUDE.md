# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# 6. Run tests
pnpm test:unit        # Run unit/integration tests
# E2E tests require dev server running - run locally only
```

## Commands

```bash
pnpm dev              # Web (port 3000) + WebSocket server (port 3001) concurrently
pnpm dev:web          # Web only
pnpm dev:ws           # WebSocket server only (tsx watch)

pnpm test:unit        # Run all Vitest tests (unit + integration)
pnpm test:e2e         # Playwright E2E tests - run locally only (requires dev server)
pnpm test:e2e:ui      # E2E tests with UI mode
pnpm test:watch       # Vitest watch mode
pnpm test:coverage    # Coverage report (90%+ threshold enforced)
node_modules/.bin/vitest run tests/unit/path/to/test.ts  # Run a single test file

pnpm lint             # Biome lint
pnpm format           # Biome format
pnpm check            # Biome lint + format together

pnpm db:push          # Push schema changes (dev)
pnpm db:generate      # Generate migration files
pnpm db:migrate       # Run migrations
pnpm db:studio        # Drizzle Studio UI
```

**E2E tests** (`pnpm test:e2e`) require the dev server running and are NOT run in CI. Run locally before major releases.

## Code Style

Formatter is **Biome** (not Prettier). Config in `biome.json`:
- Indentation: **tabs**
- Quotes: **double**
- Import alias: `#/` maps to `src/`
- No non-null assertions (`!`)

Run `pnpm check` before committing.

## Architecture

### Two-Process Model

The app runs as two separate processes:
1. **Web app** (`vite dev`, port 3000) — TanStack Start (React 19 + SSR)
2. **WebSocket server** (`tsx watch websocket/websocket-server.ts`, port 3001) — standalone Node.js process

The WebSocket server is the **primary source of truth** for runtime state. The database is a persistence layer only.

### Data Flow (WebSocket-First)

```
Frontend → WebSocket Server → DB (sync write) → Broadcast to room
                ↓
          In-Memory Maps (primary state during runtime)
```

All room operations (create, join, leave, transfer) go through WebSocket. The frontend **never** writes to the DB directly. DB writes block until confirmed before the server broadcasts to other clients.

### WebSocket Server Layout (`websocket/`)

```
websocket/
├── websocket-server.ts       # Entry point, socket lifecycle, SocketUserData type
├── room/
│   ├── state.ts              # In-memory room state (Maps), serialization
│   ├── events.ts             # room:create/join/leave/rejoin/transfer handlers
│   └── persistence.ts        # All DB write operations for rooms
├── streaming/
│   └── events.ts             # peerjs:ready/streamer_ready/screen_share_ended handlers
└── chat/
    └── events.ts             # chat:send handler
```

`SocketUserData` (exported from `websocket-server.ts`) is the canonical socket data type — import it, never redefine it locally.

### Frontend Layout (`src/`)

```
src/
├── routes/                   # TanStack Router file-based routes
│   ├── __root.tsx            # Root layout (WebSocketProvider, PeerJSProvider)
│   ├── index.tsx             # Home page
│   └── room.$roomId.tsx      # Room page
├── hooks/
│   ├── useRoom.ts            # Room state via WebSocket events
│   └── usePeerJS.ts          # PeerJS streaming + retry logic
├── components/
│   ├── VideoDisplay.tsx      # Viewer video with connection status overlays
│   ├── ScreenSharePreview.tsx # Streamer local preview
│   ├── TransferOverlay.tsx   # Streamer-change overlay
│   └── StreamingErrorBoundary.tsx
├── lib/
│   ├── peerjs-context.tsx    # PeerJS singleton (prevents duplicate Peer instances)
│   ├── websocket-context.tsx # Socket.io connection context
│   ├── connection-retry.ts   # Exponential backoff retry manager
│   ├── rate-limiter.ts       # InMemoryBackend rate limiter, RateLimits constants
│   └── profanity-filter.ts   # censorText() using @2toad/profanity
├── db/                       # SERVER-ONLY — never import at module level in client files
│   ├── schema.ts             # Drizzle table definitions
│   └── queries/              # DB query functions
└── types/
    └── webrtc.ts             # ConnectionStatus type (single canonical definition)
```

### Critical: Database Import Rule

**Never import `src/db/` at the top level of any file that runs in the browser.** DB uses Node.js-only modules. Always use dynamic imports inside server functions:

```typescript
// ✅ Correct
const myFn = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await import("#/db/index");
  return db.query.users.findMany();
});

// ❌ Will crash browser
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

### PeerJS Streaming Architecture

Streaming uses **PeerJS** (WebRTC abstraction) with Socket.io for signaling:

1. Streamer calls `peerjs:streamer_ready` with their `peerId` → stored in `room.streamerPeerId` in-memory + broadcast via `room:state_sync`
2. Viewers auto-connect to `streamerPeerId` from room state (late-joiner support)
3. `PeerJSProvider` (in `__root.tsx`) holds a singleton `Peer` instance to prevent duplicates
4. `usePeerJS` consumes the context via `usePeerJSContext()`

`ConnectionRetryManager` (`src/lib/connection-retry.ts`) provides exponential backoff with jitter for viewer reconnects. `ConnectionStatus` type is defined only in `src/types/webrtc.ts` — do not redefine it elsewhere.

### Room Lifecycle

States: `waiting → preparing → active → ended`

- **waiting**: No streamer assigned
- **preparing**: Streamer present but <2 participants OR stream not started
- **active**: Streamer streaming + 2+ participants
- **ended**: Empty for 5+ minutes (cleanup job runs every 5 min)

Streamer transfer is automatic when the streamer leaves. 30-second cooldown keyed as `${roomId}:${userId}`. Mobile users cannot be streamers.

#### Joining Rules
- User can only be in ONE room at a time
- Joining a waiting room → auto-becomes streamer
- 2nd participant joins → room becomes active
- Can rejoin waiting rooms after leaving

#### Room Status Transitions

**Streamer stops streaming (but stays in room):** status → `preparing`, streamer remains assigned.

**Streamer leaves room:**
1. Eligible viewer exists → they become streamer → status = `preparing`
2. No eligible viewers → streamerId = null → status = `waiting`

#### Cleanup (Only Empty Rooms)

Room only ends when ALL of:
1. Status is `waiting` (no active streamer)
2. No participants present (empty for 5+ minutes)
3. Room created > 5 minutes ago

Ended rooms visible for 3 hours in "Past Streams". Cleanup job runs every 5 minutes.

### Rate Limiting

All rate limits are defined in `src/lib/rate-limiter.ts` (`RateLimits` object) and enforced in WebSocket handlers. Key limits: `CHAT_SEND` (30/15s), `CHAT_RAPID` (5/3s), `WEBRTC_SIGNALING` (200/min), `STREAMER_TRANSFER` (1/30s), `ROOM_JOIN` (10/min).

### Styling

Use semantic CSS variables from the theme system — no arbitrary values:
- Backgrounds: `bg-depth-0` through `bg-depth-4`
- Text: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`
- Accent: `text-accent`, `bg-accent`
- Status: `text-success`, `text-warning`, `text-danger`
- Borders: `border-border-subtle`
- Rounded: `rounded-xl` for interactive elements

## Testing

Tests use **Vitest v3** with jsdom. Tests run single-threaded (no parallel file execution) to avoid DB conflicts.

Run single file: `node_modules/.bin/vitest run tests/unit/path/to/test.ts`

When mocking PeerJS in tests, use `vi.hoisted()` to create mock instances before `vi.mock()` factory runs:

```typescript
const { MockPeer } = vi.hoisted(() => {
  const MockPeer = vi.fn(() => ({ id: "test-id", destroyed: false, destroy: vi.fn() }));
  return { MockPeer };
});
vi.mock("peerjs", () => ({ default: MockPeer }));
```

jsdom doesn't implement `MediaStream` — add a stub at the top of video tests:
```typescript
if (typeof MediaStream === "undefined") {
  (globalThis as Record<string, unknown>).MediaStream = class { getTracks() { return []; } };
}
```

### E2E Testing Guidelines

E2E tests (`e2e/`) use Playwright. They are NOT run in CI — run locally before major releases.

**CRITICAL:** E2E tests must use UI-based login, not cookies (Better Auth requirement):

```typescript
import { test, expect } from "../utils/auth";

const TEST_VIEWPORT = { width: 1200, height: 800 };

async function loginUser(page: any, email: string) {
  await page.goto("/auth/sign-in");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "testpassword123");
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/", { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
}

test("example", async ({ page, signupTestUser }) => {
  const user = await signupTestUser("Test User");
  await loginUser(page, user.email);
  await page.setViewportSize(TEST_VIEWPORT); // AFTER login!
  await page.locator('button:has-text("Create Room")').first().click({ force: true });
});
```

#### Key Rules
1. **Always login via UI** — Never set cookies directly (Better Auth requirement)
2. **Set viewport AFTER login** — Setting before breaks the auth form
3. **Use `TEST_VIEWPORT`** — `{ width: 1200, height: 800 }` for Create Room button visibility
4. **Use force click** — `click({ force: true })` for buttons that may be hidden
5. **Close contexts in finally** — Prevent resource leaks in multi-user tests
6. **Use flexible regex** — `text=/\\d+ viewers?/` for viewer counts (websocket delay)
7. **Wait for websocket sync** — `await page.waitForTimeout(2000)` before checking viewer counts

#### Multi-User Pattern
```typescript
test("multi-user", async ({ browser, signupTestUser }) => {
  const user1 = await signupTestUser("User 1");
  const user2 = await signupTestUser("User 2");
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  try {
    await loginUser(await ctx1.newPage(), user1.email);
    await loginUser(await ctx2.newPage(), user2.email);
    // ... test
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});
```

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

## Docker & CI/CD

### Local Docker Development
```bash
docker compose up -d       # Build and run with Docker Compose (includes PostgreSQL)
docker compose logs -f     # View logs
docker compose down        # Stop services
```

### Production Deployment
Docker images are automatically built and pushed to GitHub Container Registry:
- **On push to main:** Tags with `main`, `sha-xxx`, `latest`
- **On version tags:** Tags with version numbers

CI/CD workflow: `.github/workflows/docker-build.yml`

## Git Commits

- **Never commit without explicit request**
- Only commit when user asks (e.g., "commit changes")
- OK to stage with `git add`, but don't commit unless requested
