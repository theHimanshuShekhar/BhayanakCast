# BhayanakCast Knowledge Base

## Project Overview

**BhayanakCast** is a TanStack Start application with a Discord-inspired dark theme, featuring user authentication, streaming rooms, real-time user tracking via WebSocket, and user relationship tracking.

## Architecture

### Framework Stack
- **Framework**: TanStack Start (React + SSR)
- **Router**: TanStack Router (file-based routing)
- **Query**: TanStack Query v5
- **Auth**: Better Auth with Discord OAuth (sole authentication method)
- **Database**: PostgreSQL 15 + Drizzle ORM
- **Real-time**: Socket.io WebSocket server
- **Styling**: Tailwind CSS v4 with custom theme
- **UI Components**: shadcn/ui + better-auth-ui
- **Debouncing**: @tanstack/pacer

### File Structure
```
src/
├── components/          # Reusable UI components
│   └── Header.tsx       # Shows real-time user count
├── db/                  # Database layer (server-only)
│   ├── index.ts         # Database connection (Pool)
│   ├── schema.ts        # Drizzle ORM schema
│   └── queries.ts       # Database query utilities
├── integrations/        # Third-party integrations
│   ├── better-auth/    # Auth providers
│   ├── posthog/        # Analytics
│   └── tanstack-query/ # Query provider
├── lib/                # Utilities and core logic
│   ├── auth.ts         # Better-auth server config
│   ├── auth-client.ts  # Better-auth client
│   ├── auth-guard.ts   # Route protection utilities
│   └── websocket-context.tsx  # Global WebSocket connection
├── routes/             # TanStack Router file-based routes
│   ├── __root.tsx      # Root layout (with WebSocketProvider)
│   ├── index.tsx       # Home page (public)
│   ├── profile.$userId.tsx  # Profile page (public)
│   └── auth/$authView.tsx   # Auth pages
├── utils/              # Server utility functions
│   └── profile.ts      # Profile data fetching (server functions)
├── styles.css          # Global styles with theme
websocket-server.ts     # Socket.io server (port 3001)
```

## Key Implementation Details

### WebSocket Server

**Socket.io Server** (runs separately on port 3001):
```typescript
// websocket-server.ts
import { Server } from "socket.io";

const io = new Server(httpServer, {
  cors: { origin: "http://localhost:3000" }
});

io.on("connection", (socket) => {
  // Track connections and broadcast user count
  io.emit("userCount", { count: io.engine.clientsCount });
});
```

**WebSocket Client** (global context):
```typescript
// src/lib/websocket-context.tsx
import { io } from "socket.io-client";
import { debounce } from "@tanstack/pacer";

// Debounced user count updates (300ms)
const debouncedUpdate = debounce(setUserCount, 300);

socket.on("userCount", (data) => {
  debouncedUpdate(data.count);
});
```

### Real-time User Count

The Header component displays live user count:
- Shows `...` while connecting
- Shows actual count with green pulse when connected
- Updates are debounced to prevent rapid re-renders

### Database Setup

**Connection**: Use `Pool` from `pg` for connection pooling:
```typescript
// src/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

**⚠️ CRITICAL**: Database imports must ONLY be used in server functions:
```typescript
// ✅ CORRECT - Inside createServerFn
const getData = createServerFn({ method: "GET" })
  .handler(async () => {
    const { db } = await import("#/db/index");
    return db.query...;
  });

// ❌ WRONG - Will cause Buffer errors in browser
import { db } from "#/db/index"; // At top of route file
```

### Better Auth Configuration

**Critical**: Must use `usePlural: true` with Drizzle adapter:
```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,  // REQUIRED
    schema,
  }),
  emailAndPassword: { enabled: true },
});
```

### Route Protection

Use `beforeLoad` for auth protection in route definitions:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { requireAuth, publicRoute } from "#/lib/auth-guard";

// Protected route
export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  beforeLoad: requireAuth,
});

// Public route
export const Route = createFileRoute("/")({
  component: HomePage,
  beforeLoad: publicRoute,
});
```

**Current Public Routes**:
- `/` - Home page
- `/profile/$userId` - User profiles (viewable by anyone)
- `/auth/$authView` - Sign in/up pages

### Server Functions

Always use `inputValidator` (not `validator`) and import db dynamically:
```typescript
import { createServerFn } from "@tanstack/react-start";

const myServerFn = createServerFn({ method: "GET" })
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    // Dynamic import prevents client bundling
    const { db } = await import("#/db/index");
    return db.query...;
  });
```

### UserButton Customization

```tsx
import { UserButton } from "@daveyplate/better-auth-ui";
import { User } from "lucide-react";

<UserButton
  size="sm"
  disableDefaultLinks
  additionalLinks={[{
    label: "Profile",
    href: `/profile/${userId}`,
    icon: <User className="h-4 w-4" />,
  }]}
/>
```

### Theme System

Custom Discord-inspired dark theme with depth levels:
- `bg-depth-0` - Deepest background (#1a1b1e)
- `bg-depth-1` to `bg-depth-4` - Increasing elevation
- Never use arbitrary Tailwind values

### Environment Variables

Required in `.env.local`:
```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"

# Better Auth
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate with pnpm dlx @better-auth/cli secret>

# WebSocket Server
WS_PORT=3001
CLIENT_URL=http://localhost:3000
VITE_WS_URL=http://localhost:3001

# PostHog (optional)
VITE_POSTHOG_KEY=<optional>
```

## Development Commands

```bash
# Development (runs both web app and WebSocket server)
pnpm dev

# Run individually
pnpm dev:web    # Web app only (port 3000)
pnpm dev:ws     # WebSocket server only (port 3001)

# Build for production
pnpm build

# Run tests
pnpm test

# Lint and format
pnpm check
pnpm format
pnpm lint

# Database operations
pnpm db:generate    # Generate drizzle migrations
pnpm db:migrate     # Run migrations
pnpm db:push        # Push schema changes
pnpm db:studio      # Open drizzle studio

# Docker
pnpm docker:up      # Start PostgreSQL
pnpm docker:down    # Stop PostgreSQL
```

## Database Schema

### Better Auth Tables (Auto-managed)
- `users` - User accounts (populated from Discord OAuth)
  - **name**: Discord username
  - **email**: Discord email
  - **image**: Discord avatar URL
  - **emailVerified**: Discord verification status
- `sessions` - Active sessions
- `accounts` - OAuth accounts (Discord link)
- `verifications` - Email verification codes

### Discord OAuth Integration
**User Data Flow:**
1. User clicks "Continue with Discord" on `/auth/sign-in`
2. Discord OAuth redirects to `/api/auth/callback/discord`
3. `auth.ts` fetches user profile from Discord API
4. User data synced: username, email, avatar URL
5. Existing users updated, new users created automatically
6. Profile refreshes on every login

**Avatar URL Format:**
```
https://cdn.discordapp.com/avatars/{discordUserId}/{avatarHash}.png
```

### Application Tables
- `streaming_rooms` - Active/past streaming sessions (streamerId is nullable)
  - **status**: `waiting` | `preparing` | `active` | `ended`
- `room_participants` - User participation in rooms
- `user_relationships` - Aggregated time between users
- `user_room_overlaps` - Detailed overlap logs

## Common Issues & Solutions

### Buffer is not defined Error
**Cause**: Database imports being bundled for client side
**Solution**: Use dynamic imports inside server functions only

### 422 Error on Sign-up
**Cause**: Missing database adapter configuration
**Solution**: Ensure `drizzleAdapter` has `usePlural: true`

### "Model 'user' not found" Error
**Cause**: Better Auth looking for singular table names
**Solution**: Add `usePlural: true` to adapter config

### Type Errors with Server Functions
**Cause**: Using `.validator()` instead of `.inputValidator()`
**Solution**: Use `.inputValidator()` method

### Database Import Errors
**Cause**: Using wrong import path or importing at top level
**Solution**: Use dynamic imports inside `createServerFn` handlers

## Code Style Guidelines

### Formatting
- **Indentation**: Tabs (configured in biome.json)
- **Quotes**: Double quotes for strings
- **Formatter**: Biome (not Prettier)
- **No non-null assertions**: Use proper validation instead of `!`

### Imports
- Use path alias `#/` for src imports
- Dynamic import database modules in server functions
- Organize imports automatically (Biome handles this)

### TypeScript
- Strict mode enabled
- No unused locals or parameters (enforced)
- Prefer interfaces for object shapes
- Use `type` for type imports when possible

## Room System Architecture

### Room Lifecycle

**Room States:**
```
(none) --create--> PREPARING --stream starts--> ACTIVE
    |
    +-- streamer leaves, no viewers left --> WAITING --empty 5min--> ENDED --3hrs--> (hidden)
```

**Creating a Room:**
1. User opens CreateRoomModal → submits name + description
2. Server validates auth, auto-leaves previous room if any
3. Creates `streamingRooms` record with user as streamer
4. Inserts `room_participants` record (streamer as participant)
5. WebSocket: Join room channel
6. Navigate to `/room/$roomId`

**Joining a Room:**
1. Check if already in a room → leave previous if so
2. Insert new `room_participants` record
3. WebSocket: `room:join` event broadcast

**Leaving a Room:**
1. Update `leftAt` timestamp, calculate `totalTimeSeconds`
2. If streamer leaving:
   - Find first joined viewer (oldest `joinedAt`)
   - Transfer ownership: update `streamingRooms.streamerId`
   - Old streamer becomes regular participant
   - WebSocket: `room:streamer_changed` event
3. If no viewers to transfer to: set streamerId to null, status to `waiting`
4. If no participants remain: schedule 5-min grace period

**Streamer Transfer (Manual):**
- Streamer clicks "Transfer Stream" → selects viewer
- 30-second cooldown between transfers
- Automatic transfer (no viewer acceptance needed)

**Room Cleanup (Cron Job):**
- Runs every 5 minutes
- Finds `waiting` rooms (no streamer) with no participants for 5+ minutes
- Updates status to "ended", sets `endedAt`
- WebSocket: `room:ended` event

**Past Streams Visibility:**
- Ended rooms visible for 3 hours after ending
- Query filter: `endedAt >= NOW() - INTERVAL '3 hours'`
- Direct URLs still work after 3 hours (for bookmarks)

### Single-Room Constraint

Each user can only be in ONE room at a time:
```typescript
async function joinRoom(userId, roomId) {
  const currentRoom = await getCurrentRoom(userId);
  if (currentRoom) {
    await leaveRoom(userId, currentRoom.id);
  }
  await insertParticipant(userId, roomId);
}
```

### Room Status System

| Status | Description | Visual Indicator |
|--------|-------------|------------------|
| `waiting` | No streamer or viewers present | Gray dot • "Waiting" |
| `preparing` | Streamer present but not streaming | Yellow dot • "Preparing" |
| `active` | Streamer actively streaming | Green dot • "Streaming" |
| `ended` | Room closed after grace period | History icon • "Ended" |

**Status Transitions:**
- **Create Room** → `preparing` (streamer joins as first participant)
- **Streamer Leaves + Viewers Remain** → New streamer promoted, stays `preparing`
- **Streamer Leaves + No Viewers** → `waiting` (streamerId set to null)
- **Waiting + 5 min empty** → `ended` (cleanup cron job)

**Database Schema:**
- `streamerId` is nullable (onDelete: "set null")
- `status` has 4 values: waiting, preparing, active, ended
- Default status: `waiting`

**Queries:**
- Use `leftJoin` for streamer relationship to handle null cases
- All room queries fetch `waiting`, `preparing`, and `active` rooms
- Ended rooms only visible for 3 hours

### WebSocket Room Events

- `room:join` - User joined room
- `room:leave` - User left room  
- `room:streamer_changed` - New streamer assigned (empty string if null)
- `room:ended` - Room closed

### Active Room Indicator

- Shows on: Home page, Profile page
- Hidden on: Room page, Auth pages
- Displays: Room name, participant count, Leave button
- Updates in real-time via WebSocket

## Future Enhancements

Potential features to implement:
- [x] Room creation and management UI
- [x] Room status system (waiting, preparing, active, ended)
- [x] Nullable streamer support
- [ ] Real-time chat in streaming rooms
- [ ] WebRTC integration for video/audio streaming
- [ ] User search functionality
- [ ] Friend request system
- [ ] Notifications system
- [ ] User settings page
- [ ] Admin dashboard

## Important Notes

1. **Never commit secrets** - `.env.local` contains sensitive data
2. **Database imports** - Only use inside server functions with dynamic imports
3. **Route files** - Must match TanStack Router's file-based routing conventions
4. **Server functions** - Always validate input data
5. **Theme** - Hardcoded to dark mode in `__root.tsx`
6. **Auth redirects** - Use `beforeLoad` for SSR-safe redirects
7. **WebSocket** - Runs on port 3001, separate from web app (port 3000)
8. **Caching** - 30-minute TTL default, 2-minute for community stats and room data
9. **Room cleanup** - Runs every 5 minutes, ends `waiting` rooms empty for 5+ minutes
10. **Streamer null** - Rooms can exist without streamer (enters `waiting` status)

## References

- [Socket.io Docs](https://socket.io/docs/)
- [TanStack Pacer Docs](https://tanstack.com/pacer/latest)
- [Better Auth UI Docs](https://better-auth-ui.com)
- [TanStack Router Docs](https://tanstack.com/router/latest)
- [TanStack Start Docs](https://tanstack.com/start/latest)
- [Drizzle ORM Docs](https://orm.drizzle.team)
- [Better Auth Docs](https://www.better-auth.com)
