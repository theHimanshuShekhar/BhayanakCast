# Project Structure

Overview of the BhayanakCast codebase organization.

## Directory Layout

```
BhayanakCast/
├── src/                          # Main application source
│   ├── components/              # React UI components
│   │   ├── Chat.tsx            # Chat interface
│   │   ├── RoomCard.tsx        # Room display card
│   │   ├── RoomList.tsx        # Room listing page
│   │   ├── Header.tsx          # Navigation header
│   │   ├── StreamerControls.tsx # Streaming controls
│   │   ├── AudioConfigModal.tsx # Audio configuration modal
│   │   └── ...                 # Other components
│   │
│   ├── hooks/                   # React hooks
│   │   ├── useWebRTC.ts        # WebRTC streaming hook
│   │   └── useRoom.ts          # Room state subscription
│   │
│   ├── db/                      # Database layer (SERVER-ONLY)
│   │   ├── schema.ts           # Drizzle ORM table definitions
│   │   ├── index.ts            # Database connection
│   │   └── queries/            # Query functions
│   │       ├── stats.ts        # Statistics queries
│   │       └── community-stats.ts
│   │
│   ├── lib/                     # Core utilities and configurations
│   │   ├── auth.ts             # Better Auth configuration
│   │   ├── auth-guard.ts       # Authentication guards
│   │   ├── rate-limiter.ts     # Rate limiting system
│   │   ├── profanity-filter.ts # Content filtering
│   │   ├── websocket-context.tsx # WebSocket React context
│   │   └── utils.ts            # General utilities
│   │
│   ├── routes/                  # TanStack Router file-based routes
│   │   ├── __root.tsx          # Root layout
│   │   ├── index.tsx           # Home page (/)
│   │   ├── room.$roomId.tsx    # Room detail page (/room/:id)
│   │   └── api/                # API routes
│   │       └── auth/
│   │           └── $.ts        # Auth callback handler
│   │
│   ├── utils/                   # Server utility functions
│   │   ├── rooms.ts            # Room CRUD operations
│   │   ├── home.ts             # Home page data
│   │   ├── profile.ts          # Profile operations
│   │   ├── websocket-client.ts # WebSocket client utilities
│   │   └── room-cleanup.ts     # Cleanup job logic
│   │
│   ├── styles.css              # Global styles with theme system
│   └── routeTree.gen.ts        # Auto-generated route tree
│
├── websocket/                   # WebSocket server (separate process)
│   ├── websocket-server.ts     # Socket.io server entry
│   ├── websocket-room-manager.ts # Legacy room state management
│   ├── room-state.ts           # ⭐ In-memory state management
│   ├── room-events.ts          # ⭐ Room event handlers
│   └── db-persistence.ts       # ⭐ Database persistence layer
│
├── tests/                       # Test files
│   ├── unit/                   # Unit tests
│   ├── integration/            # Integration tests
│   ├── fixtures/               # Test data fixtures
│   └── utils/                  # Test utilities
│
├── docs/                        # Documentation
├── drizzle/                     # Database migrations
├── public/                      # Static assets
└── Configuration files
    ├── tanstack-start.config.ts
    ├── drizzle.config.ts
    ├── vitest.config.ts
    └── biome.json
```

## Key Principles

### Server-Only Code

The `src/db/` directory is **SERVER-ONLY**. Never import it in client-side code:

```typescript
// ✅ CORRECT - Dynamic import inside server function
const myFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const { db } = await import("#/db/index");
    return db.query.users.findMany();
  });

// ❌ WRONG - Will cause Buffer error in browser
import { db } from "#/db/index";
```

### Import Aliases

Always use the `#/` alias for src imports:

```typescript
// ✅ CORRECT
import { RoomCard } from "#/components/RoomCard";
import { users } from "#/db/schema";

// ❌ WRONG - Relative imports
import { RoomCard } from "../components/RoomCard";
```

### File Naming

- Components: PascalCase (`RoomCard.tsx`)
- Utilities: camelCase (`rate-limiter.ts`)
- Routes: Follow TanStack Router conventions (`room.$roomId.tsx`)
- Tests: `.test.ts` or `.test.tsx` suffix

## Component Organization

Components are organized by feature:

- **Layout components:** Header, Footer, Layout
- **Room components:** RoomCard, RoomList, RoomGrid
- **Chat components:** Chat, ChatMessage, ChatInput
- **User components:** UserAvatar, UserStatsCard

## Database Organization

- **Schema:** All table definitions in `schema.ts`
- **Queries:** Organized by feature in `queries/` directory
- **Relations:** Defined in schema using Drizzle relations

## WebSocket Architecture

WebSocket server runs as a separate process with in-memory state management:

### Core Files
- **websocket-server.ts:** Entry point, Socket.io setup
- **room-state.ts:** ⭐ In-memory state management (primary source of truth)
- **room-events.ts:** ⭐ WebSocket event handlers for room operations
- **db-persistence.ts:** ⭐ Synchronous database persistence layer
- **websocket-room-manager.ts:** Legacy room state management (being phased out)

### Architecture Pattern
```
Frontend → WebSocket Server → Database (sync) → Broadcast
              ↓
         In-Memory State (primary)
```

### Key Principles
1. **WebSocket-first:** All room operations go through WebSocket events
2. **In-memory primary:** Room state is maintained in Maps during runtime
3. **Sync DB writes:** Database operations complete before broadcasting
4. **Auto-rejoin:** Clients automatically recover after server restart

## See Also

- [Getting Started](./GETTING_STARTED.md) - Development setup
- [Database Schema](./DATABASE_SCHEMA.md) - Table definitions
- [Coding Standards](./CODING_STANDARDS.md) - Code style guide
