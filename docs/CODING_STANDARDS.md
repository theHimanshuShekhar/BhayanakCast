# Coding Standards

Code style guidelines and critical rules for BhayanakCast.

## Code Style

### Formatting

- **Indentation:** Tabs (not spaces)
- **Quotes:** Double quotes
- **Formatter:** Biome (not Prettier)
- **Semicolons:** Required
- **Line endings:** LF

### TypeScript

- **Strict mode:** Enabled
- **Non-null assertions:** Forbidden (`!` operator)
- **Explicit types:** Required for function parameters and returns
- **No `any`:** Use `unknown` with type guards instead

```typescript
// ✅ CORRECT
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  return hours > 0 ? `${hours}h` : `${Math.floor(seconds / 60)}m`;
}

// ❌ WRONG
function formatDuration(seconds) {
  return seconds / 3600;
}
```

### Imports

- **Alias:** Use `#/` for src imports
- **Ordering:** External libs first, then `#/` imports, then relative
- **Grouping:** Group by category with blank lines

```typescript
// ✅ CORRECT
import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { RoomCard } from "#/components/RoomCard";
import { useWebSocket } from "#/lib/websocket-context";

import { formatDate } from "./utils";
```

## Critical Rules

### Database Imports (MOST IMPORTANT)

⚠️ **NEVER import database at the top level of client files**

Database imports use Node.js-only modules (Buffer, crypto) that break the browser.

```typescript
// ✅ CORRECT - Dynamic import inside server function
export const getRooms = createServerFn({ method: "GET" })
  .handler(async () => {
    const { db } = await import("#/db/index");
    return db.query.users.findMany();
  });

// ❌ WRONG - Will crash the browser with "Buffer is not defined"
import { db } from "#/db/index";
export function Component() {
  const data = db.query.users.findMany(); // CRASH!
}
```

### Styling Guidelines

- **Theme:** Use depth-based colors (`bg-depth-0` to `bg-depth-4`)
- **No arbitrary values:** Never use `[100px]` or similar
- **Interactive elements:** Use `rounded-xl` for buttons/cards
- **Status colors:** Use semantic colors (`text-success`, `text-danger`)

```typescript
// ✅ CORRECT
<div className="bg-depth-1 rounded-xl border border-border-subtle">
  <span className="text-success">Online</span>
</div>

// ❌ WRONG
<div className="bg-[#1a1a1a] rounded-[10px]">
  <span className="text-[#00ff00]">Online</span>
</div>
```

### Component Patterns

**Data Fetching:** Use React Query, never `useEffect` + `fetch`:

```typescript
// ✅ CORRECT
const { data } = useQuery({
  queryKey: ["rooms"],
  queryFn: () => getActiveRooms(),
  staleTime: 30 * 60 * 1000,
});

// ❌ WRONG
useEffect(() => {
  fetch("/api/rooms").then(r => r.json()).then(setRooms);
}, []);
```

**Server Functions:**

```typescript
// ✅ CORRECT
export const myFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { db } = await import("#/db/index");
    return db.query.users.findFirst({
      where: eq(users.id, data.id)
    });
  });
```

### Error Handling

Always handle errors gracefully:

```typescript
// ✅ CORRECT
try {
  const result = await createRoom({ data: roomData });
  if (!result.success) {
    toast.error(result.error);
    return;
  }
  toast.success("Room created!");
} catch (error) {
  toast.error("Failed to create room");
  console.error(error);
}
```

### Naming Conventions

- **Components:** PascalCase (`RoomCard`, `UserAvatar`)
- **Functions:** camelCase (`createRoom`, `getUserStats`)
- **Constants:** UPPER_SNAKE_CASE (`RATE_LIMITS`, `API_BASE_URL`)
- **Files:** Match the default export name
- **Types/Interfaces:** PascalCase with descriptive names

```typescript
// ✅ CORRECT
interface RoomParticipant {
  id: string;
  userId: string;
  joinedAt: Date;
}

export const MAX_ROOM_NAME_LENGTH = 100;

export function RoomCard({ room }: RoomCardProps) {
  // ...
}
```

## Testing Standards

### Test Structure

```typescript
// ✅ CORRECT
describe("RoomCard", () => {
  it("renders room name", () => {
    render(<RoomCard room={mockRoom} />);
    expect(screen.getByText("Test Room")).toBeInTheDocument();
  });
  
  it("shows live indicator when streaming", () => {
    render(<RoomCard room={activeRoom} />);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });
});
```

### Test Coverage

- **Minimum:** 90% threshold
- **Unit tests:** Test pure functions and components
- **Integration:** Test database queries
- **File naming:** `ComponentName.test.tsx`

## Git Commit Guidelines

- **Format:** `type: description` (lowercase)
- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- **Present tense:** "add feature" not "added feature"
- **Concise:** Max 72 characters in subject

```bash
# ✅ CORRECT
git commit -m "feat: add room search functionality"
git commit -m "fix: resolve streamer transfer cooldown"
git commit -m "test: add rate limiting tests"

# ❌ WRONG
git commit -m "Added new feature"
git commit -m "FIX: bug"
```

## See Also

- [Getting Started](./GETTING_STARTED.md) - Development setup
- [Testing Guide](./TESTING.md) - Testing documentation
- [Project Structure](./PROJECT_STRUCTURE.md) - Directory layout
