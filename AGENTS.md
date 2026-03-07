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

### Room Lifecycle

**Creating a Room:**
1. User clicks "Create Room" button → opens `CreateRoomModal`
2. User enters name (required, 3-100 chars) and description (optional, max 500)
3. Server validates authentication and creates room
4. User is automatically added as streamer and participant
5. Redirect to `/room/$roomId`

**Joining a Room:**
1. User can only be in ONE room at a time
2. If already in a room, auto-leave previous room first
3. Join new room as participant
4. WebSocket notifies room of new participant

**Leaving a Room:**
1. Update `leftAt` timestamp and calculate `totalTimeSeconds`
2. If streamer leaving:
   - Find first joined viewer (oldest participation)
   - Transfer streamer ownership automatically
   - Old streamer becomes regular participant
   - Show confirmation modal before leaving
3. If no viewers left: set streamerId to null, status to `waiting`
4. If last person leaves: room enters 5-minute grace period

**Streamer Transfer:**
- **Automatic**: When streamer leaves/joins another room
- **Manual**: Streamer can voluntarily transfer to any viewer
- 30-second cooldown between transfers
- Transfer is automatic (no viewer acceptance needed)
- If no viewers to transfer to: streamerId set to null, status becomes `waiting`

**Room Cleanup (Cron Job):**
- Runs every 5 minutes
- Ends `waiting` rooms that have been empty for > 5 minutes
- Past streams visible for 3 hours after ending

**Room Status System:**
| Status | Description | Visual Indicator |
|--------|-------------|------------------|
| `waiting` | No streamer or viewers present | Gray dot • "Waiting" |
| `preparing` | Streamer present but not streaming | Yellow dot • "Preparing" |
| `active` | Streamer actively streaming | Green dot • "Streaming" |
| `ended` | Room cleaned up | History icon • "Ended" |

### Active Room Indicator
- Shows on: Home page, Profile page
- Hidden on: Room page, Auth pages
- Displays: Room name, participant count, Leave button
- Click "View Room" to navigate to room

### WebSocket Room Events
- `room:join` - User joined room
- `room:leave` - User left room
- `room:streamer_changed` - Streamer ownership transferred
- `room:ended` - Room closed after grace period

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
