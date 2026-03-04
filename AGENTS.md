# AGENTS.md - Coding Guidelines for BhayanakCast

## Build & Development Commands

```bash
# Development server (runs both web and websocket)
pnpm dev

# Build for production
pnpm build

# Run all tests
pnpm test

# Run a single test file
pnpm vitest run path/to/test.ts

# Run tests in watch mode
pnpm vitest

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
- **Font**: JetBrains Mono (monospace) loaded from Google Fonts CDN
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
- Framework: Vitest with jsdom environment
- Test utilities: @testing-library/react
- Place tests alongside source files or in `__tests__` folders

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
- `streaming_rooms` - Rooms (id, name, description, streamerId, status, createdAt, endedAt)
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

- **Client-side**: TanStack Query with 30-minute staleTime
- **Server-side**: In-memory cache with 30-minute TTL
- **Location**: `src/db/queries/stats.ts`

## Environment Variables

Required in `.env.local`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate with pnpm dlx @better-auth/cli secret>
VITE_POSTHOG_KEY=<optional>
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
