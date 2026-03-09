# AGENTS.md - Coding Guidelines for BhayanakCast

## Commands

```bash
# Development
pnpm dev              # Web (3000) + WebSocket (3001)
pnpm dev:web          # Web only
pnpm dev:ws           # WebSocket only

# Testing
pnpm test             # All tests (requires PostgreSQL)
pnpm vitest run path/to/test.ts

# Quality
pnpm lint
pnpm format
pnpm check

# Database
pnpm db:push          # Push schema changes
pnpm db:studio        # Drizzle Studio
```

## Code Style

- **Indentation**: Tabs
- **Quotes**: Double
- **Formatter**: Biome (not Prettier)
- **No non-null assertions** (`!`)
- **Imports**: Use `#/` alias for src

## Database Rules (CRITICAL)

⚠️ **Database imports ONLY in server functions:**
```typescript
// ✅ CORRECT
const myFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const { db } = await import("#/db/index");
    return db.query.users.findMany();
  });

// ❌ WRONG - Causes Buffer error in browser
import { db } from "#/db/index";
```

## Component Patterns

**Data Fetching:**
```typescript
// Use React Query, never useEffect + fetch
const { data } = useQuery({
  queryKey: ["rooms"],
  queryFn: () => getActiveRooms(),
  staleTime: 30 * 60 * 1000, // 30 min
});
```

**Server Functions:**
```typescript
// Always use inputValidator (not validator)
const myFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { db } = await import("#/db/index");
    // ... database queries
  });
```

## Styling

- **Theme**: Use `bg-depth-0` to `bg-depth-4` (no arbitrary values)
- **Colors**: `text-accent`, `bg-accent` for theme colors
- **Status**: `text-success`, `text-warning`, `text-danger`, `text-info`
- **Rounded**: Use `rounded-xl` for interactive elements

## Testing

- **Framework**: Vitest v3 + jsdom
- **Coverage**: 90%+ threshold
- **Location**: `tests/unit/` and `tests/integration/`
- **Test DB**: `bhayanak_cast_test` (cleared before each test)

```typescript
// Unit test
import { render, screen } from "@testing-library/react";
describe("RoomCard", () => {
  it("renders room name", () => {
    render(<RoomCard room={mockRoom} />);
    expect(screen.getByText("Test Room")).toBeInTheDocument();
  });
});
```

## Project Structure

```
src/
├── components/      # UI components
├── db/             # Database (SERVER-ONLY)
├── lib/            # Utilities
├── routes/         # TanStack Router routes
├── utils/          # Server functions
└── styles.css      # Global styles

websocket/          # WebSocket server
├── websocket-server.ts
└── websocket-room-manager.ts
```

## Room System Business Logic

**Streamer Departure:**
1. Streamer leaves → earliest viewer auto-becomes streamer
2. No viewers → streamerId = null, status = waiting
3. Transfer is automatic (no acceptance needed)

**Joining:**
- User can only be in ONE room at a time
- Joining waiting room → auto-becomes streamer

**Cleanup:**
- Waiting rooms empty for 5 min → status = ended
- Ended rooms visible for 3 hours

## Environment Variables

Required in `.env.local`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate with pnpm dlx @better-auth/cli secret>
DISCORD_CLIENT_ID=<discord_app_id>
DISCORD_CLIENT_SECRET=<discord_secret>
VITE_WS_URL=http://localhost:3001
```

## Git Commits

- **Never commit without explicit request**
- Only commit when user asks (e.g., "commit changes")
- OK to stage with `git add`, but don't commit unless requested

## Key Files

- **Auth config**: `src/lib/auth.ts` (usePlural: true REQUIRED)
- **WebSocket**: `websocket/websocket-server.ts`
- **Schema**: `src/db/schema.ts`
- **Queries**: `src/db/queries/stats.ts`
- **KNOWLEDGEBASE.md** - Technical details
- **PLAN.md** - Roadmap and features
