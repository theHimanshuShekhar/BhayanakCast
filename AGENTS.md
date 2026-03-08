# AGENTS.md - Coding Guidelines for BhayanakCast

## Agent Rules

### Git Commits
- **Never commit changes without explicit user request**
- Only create commits when the user specifically asks (e.g., "commit changes", "commit this", etc.)
- It's acceptable to stage files with `git add` but do not run `git commit` unless requested
- If unsure whether to commit, ask the user first

## Build & Development Commands

```bash
# Development server (runs both web and websocket)
pnpm dev

# Build for production
pnpm build

# Run all tests (automatically uses test database)
pnpm test

# Run a single test file
pnpm vitest run path/to/test.ts

# Run tests in watch mode
pnpm vitest

# Setup test database (one-time)
pnpm test:setup

# Lint code
pnpm lint

# Format code
pnpm format

# Check format and lint
pnpm check

# Database operations
pnpm db:generate    # Generate drizzle migrations
pnpm db:migrate     # Run migrations
pnpm db:push        # Push schema changes
pnpm db:studio      # Open drizzle studio
```

## Code Style Guidelines

### Formatting
- **Indentation**: Tabs (configured in biome.json)
- **Quotes**: Double quotes for strings
- **Line endings**: LF
- **Formatter**: Biome (not Prettier)

### Imports
- Use path alias `#/` for src imports: `import { auth } from "#/lib/auth"`
- Organize imports automatically (Biome handles this)
- Group: React/External libs → Internal modules → Types

### Component Naming
- Components: PascalCase (e.g., `Header.tsx`, `UserButton`)
- Default exports for page components and shared components
- Function components with explicit return types when complex

### Types & TypeScript
- Strict TypeScript enabled
- No unused locals or parameters (enforced)
- Use `type` for type imports when possible
- Prefer interfaces for object shapes

### Error Handling
- Use Zod for runtime validation
- Handle async errors with try/catch
- Use `void` prefix for fire-and-forget async calls: `void authClient.signOut()`

### Styling
- **Tailwind CSS v4** with custom theme system
- **Font**: JetBrains Mono (monospace) loaded from static files in `/public/fonts/`
- Use theme CSS variables (e.g., `text-text-primary`, `bg-depth-2`)
- Components should use the depth system:
  - `bg-depth-0`: Deepest background (#1a1b1e)
  - `bg-depth-1` to `bg-depth-4`: Increasing elevation
- Never use arbitrary Tailwind values
- Prefer rounded-xl for interactive elements

### Theme System
- 4 pre-defined themes: Purple-Blue, Misty-Blue, Onyx-Black, Blue-Gray
- Use `text-accent`, `bg-accent` for theme-colored elements
- Status colors: `text-success`, `text-warning`, `text-danger`, `text-info`

### Testing
- Framework: Vitest v3 with jsdom environment
- Test utilities: @testing-library/react, @testing-library/user-event
- Place tests in `tests/` folder with subfolders for `unit/` and `integration/`
- Coverage threshold: 90% for statements, branches, functions, lines

### Test Database
- Use separate `bhayanak_cast_test` database
- Clear tables before each test (no transaction rollback)
- Test query functions directly, not `createServerFn` wrappers
- Server functions require TanStack Start runtime context

### Writing Tests
```typescript
// Unit test example
import { render, screen } from "@testing-library/react";
import { RoomCard } from "../../src/components/RoomCard";

describe("RoomCard", () => {
  it("renders room name", () => {
    render(<RoomCard room={mockRoom} />);
    expect(screen.getByText("Test Room")).toBeInTheDocument();
  });
});

// Integration test example
import { clearTables } from "../utils/database";
import { getActiveRooms } from "../../src/db/queries/stats";

describe("Room Management", () => {
  beforeEach(async () => {
    await clearTables();
    await insertTestUsers(db);
    await insertTestRooms(db);
  });

  it("returns active rooms", async () => {
    const rooms = await getActiveRooms();
    expect(rooms.length).toBeGreaterThan(0);
  });
});
```

## Project Structure

```
src/
├── components/              # Reusable UI components
│   ├── Header.tsx           # Toggleable left sidebar
│   ├── RoomCard.tsx         # Room display card component
│   ├── RoomList.tsx         # Room listing with debounced search
│   ├── UserStatsCard.tsx    # User profile and stats (logged in)
│   ├── AnonymousStatsColumn.tsx  # Stats for logged out users
│   ├── TopConnectionsCard.tsx    # Top 5 connections
│   ├── CommunityStatsCard.tsx    # Reusable community stats
│   ├── ThemeSwitcher.tsx    # Theme toggle button
│   ├── ClientOnly.tsx       # Client-side only render wrapper
│   └── ui/                  # shadcn/ui components
│       └── input.tsx        # Input component
├── db/                      # Database layer (SERVER-ONLY)
│   ├── index.ts             # Database connection (Pool)
│   ├── schema.ts            # Drizzle ORM schema
│   ├── queries.ts           # Database query utilities
│   └── queries/             # Additional query modules
│       └── stats.ts         # Statistics queries
├── integrations/            # Third-party service integrations
│   ├── better-auth/         # Auth providers and UI
│   ├── posthog/             # Analytics (optional)
│   └── tanstack-query/      # Query provider
├── lib/                     # Utilities and core logic
│   ├── auth.ts              # Better-auth server config
│   ├── auth-client.ts       # Better-auth client
│   ├── auth-guard.ts        # Route protection utilities
│   ├── site.ts              # Site configuration
│   ├── theme-context.tsx    # Theme provider and hook
│   └── websocket-context.tsx # Global WebSocket connection
├── routes/                  # TanStack Router file-based routes
│   ├── __root.tsx           # Root layout (with providers)
│   ├── index.tsx            # Home page (room discovery)
│   ├── room.$roomId.tsx     # Room detail page
│   ├── profile.$userId.tsx  # User profile page
│   └── auth/                # Auth pages
│       └── $authView.tsx    # Sign in/up
├── utils/                   # Server utility functions
│   ├── home.ts              # Home page data fetching
│   └── profile.ts           # Profile data fetching
└── styles.css               # Global styles with theme
```

## Key Dependencies

- **Framework**: TanStack Start (React + SSR)
- **Router**: TanStack Router (file-based routing)
- **Query**: TanStack Query v5
- **Auth**: Better Auth with better-auth-ui
- **DB**: Drizzle ORM with PostgreSQL
- **Styling**: Tailwind CSS v4 with custom theme
- **Icons**: Lucide React
- **WebSocket**: Socket.io

## Cursor Rules

From `.cursorrules`:
- Use latest shadhn CLI for adding components: `pnpm dlx shadcn@latest add <component>`

## Database

- PostgreSQL running in Docker (see docker-compose.yml)
- Connection: `postgresql://postgres:postgres@localhost:5432/postgres`
- Use drizzle-kit for schema management
- **IMPORTANT**: Database queries can ONLY be used in:
  - Server functions (`src/utils/*.ts`)
  - Route loaders (`routes/*.{tsx,ts}` with `loader`)
  - API routes
  - Never import from `#/db` in client components (causes Buffer error)

### Database Schema

**Better Auth Tables:**
- `users` - User accounts
- `sessions` - Auth sessions
- `accounts` - OAuth accounts
- `verifications` - Email verification codes

**Application Tables:**
- `streaming_rooms` - Rooms (id, name, description, streamerId **[nullable]**, status, createdAt, endedAt)
  - **status**: `waiting` | `preparing` | `active` | `ended`
- `room_participants` - Who joined what room (id, roomId, userId, joinedAt, leftAt, totalTimeSeconds)
- `user_relationships` - Time spent between users (user1Id, user2Id, totalTimeSeconds, roomsCount, lastInteractionAt)
- `user_room_overlaps` - Detailed overlap tracking

## Data Fetching Architecture

### Two-Tier Data Fetching

**1. Route Loaders (SSR - Initial Page Load)**
- Use TanStack Start `loader` for initial data
- Fetched server-side, serialized to HTML
- Provides instant page render

```typescript
// src/routes/index.tsx
export const Route = createFileRoute("/")({
  loader: async () => {
    const homeData = await getHomeData();
    return homeData;
  },
});
```

**2. React Query (Client-Side - Dynamic Data)**
- Use `useQuery` for all client-side data fetching
- Handles caching, refetching, and loading states
- Mandatory for all dynamic data after initial load

```typescript
// Components use React Query
const { data, isLoading } = useQuery({
  queryKey: ["userStats", userId],
  queryFn: async () => {
    return getUserHomeStats({ data: { userId } });
  },
  staleTime: 30 * 60 * 1000, // 30 minutes
});
```

### Data Fetching Rules

1. **Always use `useQuery` for data fetching in components**
   - Never use `useEffect` + `fetch`
   - Never use direct database queries in components
   - Never use `axios` or native `fetch`

2. **Server functions must be called through React Query**
   ```typescript
   // ✅ Good
   const { data } = useQuery({
     queryKey: ["rooms"],
     queryFn: () => getActiveRooms(),
   });
   
   // ❌ Bad
   const [data, setData] = useState();
   useEffect(() => {
     fetch('/api/rooms').then(res => res.json()).then(setData);
   }, []);
   ```

3. **Cache configuration**
   - Use `staleTime: 30 * 60 * 1000` (30 minutes) for static data
   - Use `gcTime: 60 * 60 * 1000` (1 hour) for garbage collection
   - Use `refetchOnWindowFocus: false` for non-critical data

4. **Query Keys**
   - Always include unique identifiers (userId, roomId)
   - Structure: `["entity", "action", id]`
   - Example: `["userStats", userId]`, `["rooms", "search", query]`

### Server Functions (createServerFn)

All database access must be through server functions:

```typescript
// src/utils/home.ts
export const getHomeData = createServerFn({ method: "GET" }).handler(
  async () => {
    // Database queries here
    const [activeRooms, trendingRooms] = await Promise.all([
      getActiveRooms(),
      getTrendingRooms(5),
    ]);
    return { activeRooms, trendingRooms };
  }
);
```

### Component Patterns

**For Initial Data (from Route Loader):**
```typescript
function Component() {
  const homeData = Route.useLoaderData(); // SSR data
  const { data: dynamicData } = useQuery({ // Client updates
    queryKey: ["dynamic"],
    queryFn: () => fetchDynamicData(),
  });
}
```

**For Dynamic Data Only:**
```typescript
function Component() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["stats"],
    queryFn: () => getStats(),
    staleTime: 30 * 60 * 1000,
  });
  
  if (isLoading) return <Skeleton />;
  if (error) return <Error message={error.message} />;
  return <View data={data} />;
}
```

## Caching Strategy

- **Client-side**: TanStack Query with 30-minute staleTime (2-minute for community stats)
- **Server-side**: In-memory cache with configurable TTL
  - Default: 30 minutes
  - Community stats: 2 minutes
  - Active rooms: 2 minutes
- **Location**: `src/db/queries/stats.ts`

## Environment Variables

Required in `.env.local`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate with pnpm dlx @better-auth/cli secret>
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
VITE_POSTHOG_KEY=<optional>
```

### Discord OAuth Setup (Sole Authentication Method)

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to OAuth2 → General
4. Add redirect URLs:
   - Development: `http://localhost:3000/api/auth/callback/discord`
   - Production: `https://yourdomain.com/api/auth/callback/discord`
5. Copy Client ID and Client Secret to `.env.local`

**Auth Behavior:**
- **Discord OAuth**: The ONLY authentication method (both dev and production)
- **User Profile Sync**: Discord username, email, and avatar automatically synced on every login
- **Auto Account Creation**: New users automatically created on first Discord login
- **Profile Refresh**: User data updated from Discord on every sign-in
- **No Email/Password**: Email/password authentication has been removed

## Room System Architecture

### Room Management Business Logic (CRITICAL - DO NOT CHANGE)

**Streamer Departure Rules:**
1. When streamer leaves room → earliest joined viewer automatically becomes new streamer
2. If no viewers left when streamer leaves → room has no streamer (streamerId = null), status = `waiting`
3. Streamer transfer is automatic and immediate (no acceptance needed)

**Joining Waiting Rooms:**
1. When someone joins a room with `waiting` status → they automatically become the streamer
2. Room status changes from `waiting` → `preparing` (if only 1 person) or `active` (if multiple)
3. First person to join a waiting room always becomes streamer

**Room Cleanup:**
1. `waiting` rooms with no participants for 5 minutes → status changes to `ended`
2. Cleanup job runs every 5 minutes via cron
3. Ended rooms visible for 3 hours then hidden

**Status Transitions:**
- `waiting` → `preparing`: First participant joins (becomes streamer)
- `waiting` → `ended`: Empty for 5+ minutes (cleanup job)
- `preparing` → `active`: Multiple participants present
- `active` → `preparing`: Streamer leaves, viewers remain (new streamer auto-assigned)
- `active`/`preparing` → `waiting`: Last person leaves (no streamer, room empty)

### Room Lifecycle

**Creating a Room:**
1. User clicks "Create Room" button → opens `CreateRoomModal`
2. User enters name (required, 3-100 chars) and description (optional, max 500)
3. Server validates authentication and creates room with status `preparing`
4. User is automatically added as streamer and participant
5. Redirect to `/room/$roomId`

**Joining a Room:**
1. User can only be in ONE room at a time
2. If already in a room, auto-leave previous room first
3. Join new room as participant
4. **SPECIAL**: If joining a `waiting` room → automatically become streamer
5. WebSocket notifies room of new participant

**Leaving a Room:**
1. Update `leftAt` timestamp and calculate `totalTimeSeconds`
2. If streamer leaving:
   - Find earliest joined viewer (oldest `joinedAt` timestamp)
   - Transfer streamer ownership automatically to that viewer
   - If no viewers left: set streamerId to null, status to `waiting`
3. If last person leaves: room enters 5-minute grace period (status = `waiting`)

**Streamer Transfer:**
- **Automatic**: When streamer leaves → earliest viewer becomes streamer
- **Manual**: Streamer can voluntarily transfer to any viewer
- 30-second cooldown between transfers
- Transfer is immediate (no viewer acceptance needed)

**Room Cleanup (Cron Job):**
- Runs every 5 minutes
- Ends `waiting` rooms that have been empty for > 5 minutes
- Past streams visible for 3 hours after ending

**Room Status System:**
| Status | Description | Visual Indicator |
|--------|-------------|------------------|
| `waiting` | No streamer, waiting for first participant | Gray dot • "Waiting" |
| `preparing` | Has streamer but only 1 participant | Yellow dot • "Preparing" |
| `active` | Streamer + multiple participants | Green dot • "Streaming" |
| `ended` | Room cleaned up after grace period | History icon • "Ended" |

### Active Room Indicator
- Shows on: Home page, Profile page
- Hidden on: Room page, Auth pages
- Displays: Room name, participant count, Leave button
- Click "View Room" to navigate to room

### WebSocket Room Management (Centralized)

**Architecture:** All room management logic is centralized in the WebSocket server (`websocket-server.ts`) using `websocket-room-manager.ts`.

**Why WebSocket Server:**
- Real-time presence tracking via socket connections
- Immediate state updates to all clients
- Centralized business logic enforcement
- Automatic cleanup on disconnects

**Room Manager (`websocket-room-manager.ts`):**
- `addParticipant()` - Join room with automatic streamer assignment for waiting rooms
- `removeParticipant()` - Leave room with automatic streamer transfer
- `updateRoomStatusFromPresence()` - Sync status based on actual presence
- `updateAllRoomStatusesFromPresence()` - Run every 1 minute
- `runRoomCleanupJob()` - End empty waiting rooms (runs every 5 minutes)

**Scheduled Jobs:**
- **Status Update**: Every 1 minute - Updates room status based on actual presence
- **Room Cleanup**: Every 5 minutes - Ends waiting rooms empty for 5+ minutes

**WebSocket Events:**
- `room:join` - User joined room
- `room:leave` - User left room  
- `room:streamer_changed` - Streamer ownership transferred
- `room:status_changed` - Room status updated
- `room:participant_joined` - New participant with count
- `room:participant_left` - Participant left with count
- `room:ended` - Room closed

**Client Integration:**
Clients should use WebSocket events for room operations:
```typescript
// Join room via WebSocket
socket.emit("room:join", { roomId });

// Listen for updates
socket.on("room:participant_joined", ({ userId, participantCount }) => {
  // Update UI
});

socket.on("room:streamer_changed", ({ newStreamerId }) => {
  // Update streamer display
});
```

## Development Notes

### Theme System
- Themes defined in `src/styles.css` with CSS variables
- Use `data-theme` attribute on HTML element
- Available themes: `purple-blue` (default), `misty-blue`, `onyx-black`, `blue-gray`

### Sidebar Layout
- Toggleable between compact (64px) and expanded (240px)
- Three sections: Brand Logo, Online/Theme, Auth/Toggle
- All icons must be square (w-12 h-12) in compact mode

### Room List
- Debounced search with @tanstack/pacer (300ms)
- Server-side full-text search
- Time-weighted trending algorithm

### Hydration Issues
- Use `ClientOnly` component for auth-dependent UI
- Prevents mismatch between server (no session) and client (has session)

## Current Status

See `PLAN.md` for detailed roadmap and pending features.

**Recently Completed:**
- ✅ Multi-theme system
- ✅ Real data backend with caching
- ✅ User stats with React Query
- ✅ Top connections with real data
- ✅ Server-side room search
- ✅ Anonymous user stats column
- ✅ Community stats reusable component
- ✅ Create Room functionality with modal
- ✅ Room lifecycle (join/leave/transfer)
- ✅ Streamer ownership transfer (auto & manual)
- ✅ Active Room indicator
- ✅ 5-minute room cleanup cron job
- ✅ Discord OAuth authentication
- ✅ JetBrains Mono static fonts
- ✅ **Room Status System** - Four states: waiting, preparing, active, ended
- ✅ **Nullable Streamer** - Rooms can exist without a streamer
- ✅ **Improved Caching** - Community stats refresh every 2 minutes
- ✅ **Comprehensive Test Suite** - 59 tests with 90%+ coverage (Vitest + jsdom)
- ✅ **Social Media Meta Tags** - Open Graph and Twitter Card tags for room detail page
- ✅ **Production Site URL** - Updated to https://cast.bhayanak.net
