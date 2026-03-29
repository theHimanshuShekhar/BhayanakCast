# Project Structure

## Directory Layout

```
BhayanakCast/
├── src/
│   ├── components/               # React UI components
│   │   ├── Chat.tsx
│   │   ├── CreateRoomModal.tsx
│   │   ├── Header.tsx
│   │   ├── RoomCard.tsx
│   │   ├── RoomList.tsx
│   │   ├── ScreenSharePreview.tsx  # Streamer local preview
│   │   ├── StreamerControls.tsx
│   │   ├── StreamingErrorBoundary.tsx
│   │   ├── TransferOverlay.tsx
│   │   ├── VideoDisplay.tsx        # Viewer video + connection status
│   │   └── ui/                     # shadcn/ui primitives
│   │
│   ├── hooks/
│   │   ├── usePeerJS.ts            # PeerJS streaming (streamer + viewer)
│   │   └── useRoom.ts              # Room state via WebSocket events
│   │
│   ├── lib/
│   │   ├── auth.ts / auth-client.ts / auth-guard.ts
│   │   ├── connection-retry.ts     # Exponential backoff retry manager
│   │   ├── device-detection.ts     # Mobile detection (mobile = view only)
│   │   ├── peerjs-context.tsx      # PeerJS singleton (prevents duplicate instances)
│   │   ├── profanity-filter.ts
│   │   ├── rate-limiter.ts         # InMemoryBackend + RateLimits constants
│   │   ├── streaming-error-messages.ts
│   │   └── websocket-context.tsx   # Socket.io connection + auto-rejoin
│   │
│   ├── routes/
│   │   ├── __root.tsx              # Root layout (WebSocketProvider, PeerJSProvider)
│   │   ├── index.tsx               # Home page — room browser
│   │   ├── room.$roomId.tsx        # Room page
│   │   ├── profile.$userId.tsx     # User profile (read-only, Discord identity)
│   │   └── api/                    # Auth callbacks + test auth endpoint
│   │
│   ├── types/
│   │   ├── webrtc.ts               # ConnectionStatus (single canonical definition)
│   │   └── streaming-errors.ts     # StreamingErrorType enum
│   │
│   ├── db/                         # SERVER-ONLY — never import at module level in client
│   │   ├── schema.ts               # Drizzle table definitions
│   │   ├── index.ts                # DB connection
│   │   └── queries/                # stats.ts, community-stats.ts
│   │
│   └── utils/                      # Server functions (createServerFn)
│       ├── rooms.ts                # Room CRUD
│       ├── home.ts                 # Home page loader
│       ├── profile.ts              # Profile data
│       └── room-cleanup.ts         # Cleanup job logic
│
├── websocket/                      # WebSocket server (separate Node.js process)
│   ├── websocket-server.ts         # Entry point, SocketUserData type, socket lifecycle
│   ├── room/
│   │   ├── state.ts                # In-memory room state (Maps), serialization
│   │   ├── events.ts               # room:create/join/leave/rejoin/transfer handlers
│   │   └── persistence.ts          # All DB write operations for rooms
│   ├── streaming/
│   │   ├── events.ts               # peerjs:ready/streamer_ready/screen_share_ended
│   │   └── types.ts                # Streaming event payload types
│   └── chat/
│       ├── events.ts               # chat:send handler
│       └── types.ts
│
├── tests/
│   ├── unit/                       # Vitest unit tests
│   ├── integration/                # DB query + WebSocket tests
│   └── fixtures/                   # Test data (users, rooms, participants)
│
├── e2e/                            # Playwright E2E tests (run locally only)
├── docs/                           # Documentation
├── drizzle/                        # DB migrations
└── public/                         # Static assets
```

## Critical Rules

### Server-Only Database Imports
`src/db/` uses Node.js-only modules. Never import at module level in client files:
```typescript
// ✅ Inside a server function
export const fn = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await import("#/db/index");
  return db.query.users.findMany();
});

// ❌ Will crash the browser
import { db } from "#/db/index";
```

### Import Alias
Always use `#/` for `src/` imports:
```typescript
import { usePeerJS } from "#/hooks/usePeerJS";   // ✅
import { usePeerJS } from "../hooks/usePeerJS";   // ❌
```

### WebSocket Architecture
```
Frontend → WebSocket Server → DB (sync write) → Broadcast to room
                ↓
          In-Memory Maps (primary runtime state)
```
- All room operations go through WebSocket events — never via HTTP/server functions
- `SocketUserData` (exported from `websocket/websocket-server.ts`) is the canonical socket data type

### PeerJS Streaming
- `PeerJSProvider` in `__root.tsx` holds a singleton `Peer` instance
- `usePeerJS` consumes context via `usePeerJSContext()`
- `ConnectionStatus` type defined only in `src/types/webrtc.ts`

## See Also
- [Getting Started](./GETTING_STARTED.md)
- [Database Schema](./DATABASE_SCHEMA.md)
- [WebSocket Events](./WEBSOCKET_EVENTS.md)
- [Coding Standards](./CODING_STANDARDS.md)
