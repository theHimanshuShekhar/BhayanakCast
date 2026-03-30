# Coding Standards

## Formatting

- **Formatter:** Biome (not Prettier)
- **Indentation:** Tabs
- **Quotes:** Double
- **Semicolons:** Required

Run `pnpm check` before committing. `pnpm format` auto-fixes formatting.

## TypeScript

- Strict mode enabled
- No non-null assertions (`!` operator) — forbidden
- No `any` — use `unknown` with type guards
- Explicit types for function parameters and returns

## Imports

- Use `#/` alias for all `src/` imports (never relative `../`)
- Import order: external libs → `#/` imports → relative

```typescript
import { useState } from "react";
import { RoomCard } from "#/components/RoomCard";
import { useWebSocket } from "#/lib/websocket-context";
```

## Critical Rules

### Database Imports (Most Important)

Never import `src/db/` at the module level of any file that runs in the browser. DB uses Node.js-only modules that crash the browser.

```typescript
// ✅ Correct — dynamic import inside server function
export const getRooms = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await import("#/db/index");
  return db.query.rooms.findMany();
});

// ❌ Wrong — crashes browser with "Buffer is not defined"
import { db } from "#/db/index";
```

### Room Operations via WebSocket

Room state (create, join, leave, transfer) goes through WebSocket events — never through server functions or HTTP. React Query is used for initial data loads (home page stats, room details on load), not for room operations.

### SocketUserData

Always import `SocketUserData` from `websocket/websocket-server.ts`. Never redefine it locally.

### ConnectionStatus

Defined only in `src/types/webrtc.ts`. Never redefine it elsewhere.

## Styling

Use semantic CSS variables — no arbitrary values:

```typescript
// ✅ Correct
<div className="bg-depth-1 rounded-xl border border-border-subtle">
  <span className="text-success">Connected</span>
  <span className="text-danger">Error</span>
</div>

// ❌ Wrong
<div className="bg-[#1a1a1a] rounded-[10px]">
```

Token reference:
- Backgrounds: `bg-depth-0` through `bg-depth-4`
- Text: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`
- Accent: `text-accent`, `bg-accent`
- Status: `text-success`, `text-warning`, `text-danger`
- Borders: `border-border-subtle`
- Interactive: `rounded-xl`

## Naming

- Components: PascalCase (`RoomCard`, `VideoDisplay`)
- Functions/hooks: camelCase (`useRoom`, `createRoom`)
- Constants: UPPER_SNAKE_CASE (`RATE_LIMITS`, `MAX_ROOM_NAME_LENGTH`)
- Files: match the default export name
- Tests: `.test.ts` / `.test.tsx` suffix

## Error Handling

Only validate at system boundaries (user input, external APIs). Don't add error handling for scenarios that can't happen. Don't use feature flags or fallbacks for internal code.

## Git Commits

Format: `type: description` (lowercase, present tense, max 72 chars)

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

```bash
git commit -m "feat: add room search to home page"
git commit -m "fix: reset streamerPeerId on streamer change"
```

## See Also
- [Getting Started](./GETTING_STARTED.md)
- [Project Structure](./PROJECT_STRUCTURE.md)
- [Testing Guide](./TESTING.md)
