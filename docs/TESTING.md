# Testing Guide

Complete guide to testing BhayanakCast.

## Test Framework

- **Runner:** Vitest v3
- **Environment:** jsdom (for component tests)
- **Assertions:** Vitest built-in + @testing-library/jest-dom
- **Coverage:** v8 provider with 90% threshold

## Test Structure

```
tests/
├── unit/                       # Unit tests
│   ├── rate-limiter.test.ts   # Rate limiting logic (35 tests)
│   ├── profanity-filter.test.ts # Content filtering (49 tests)
│   ├── RoomCard.test.tsx      # Component tests
│   ├── CreateRoomModal.test.tsx
│   └── CommunityStatsCard.test.tsx
│
├── integration/               # Integration tests
│   ├── room-management.test.ts    # DB queries (15 tests)
│   ├── user-stats.test.ts         # Stats queries (14 tests)
│   ├── room-list.test.tsx         # Component + DB
│   ├── rate-limiting.test.ts      # Skipped (needs server context)
│   ├── rooms.test.ts              # Skipped (needs server context)
│   └── websocket-rate-limiting.test.ts # WS rate limiting
│
├── fixtures/                  # Test data
│   ├── users.ts              # 3 test users
│   ├── rooms.ts              # 5 test rooms
│   ├── participants.ts       # Participation records
│   └── relationships.ts      # User relationships
│
└── utils/                     # Test utilities
    ├── database.ts           # Test DB connection
    ├── render.tsx            # React Query wrapper
    └── mocks.ts              # Mock utilities
```

## Running Tests

### All Tests

```bash
pnpm test
```

### Specific Test File

```bash
pnpm vitest run tests/unit/rate-limiter.test.ts
```

### Watch Mode

```bash
pnpm test:watch
```

### With Coverage

```bash
pnpm test:coverage
```

### Debug Mode

```bash
pnpm vitest run tests/unit/room-card.test.tsx --reporter=verbose
```

## Test Database

Tests use an isolated PostgreSQL database that is automatically created:

**Database:** `bhayanak_cast_test` (same server as main database)
**Connection:** Derived from DATABASE_URL in `.env.local`
**Auto-creation:** Database is created automatically if it doesn't exist
**Migrations:** Schema is synced automatically using `drizzle-kit push`

### Setup

```bash
# Start PostgreSQL (one-time)
docker compose up -d postgres

# That's it! Tests will auto-create the database and schema
pnpm test
```

### Manual Setup (Optional)

If you prefer manual control:

```bash
# Create test database manually
docker exec bhayanak-postgres createdb -U postgres bhayanak_cast_test

# Push schema
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bhayanak_cast_test" pnpm db:push
```

### Test Isolation

Each test gets a clean database state:

```typescript
// tests/setup.ts
beforeEach(async () => {
  await clearTables();        // Delete all data
  rateLimiter.resetAll();     // Reset rate limits
});
```

## Writing Tests

### Unit Test Example

```typescript
// tests/unit/rate-limiter.test.ts
describe("RateLimiter", () => {
  beforeEach(() => {
    RateLimiter.resetInstance();
  });

  it("allows requests within limit", () => {
    const limiter = RateLimiter.getInstance();
    const result = limiter.check("user1", { 
      windowMs: 60000, 
      maxAttempts: 3 
    });
    
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });
});
```

### Component Test Example

```typescript
// tests/unit/RoomCard.test.tsx
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

### Integration Test Example

```typescript
// tests/integration/room-management.test.ts
describe("getActiveRooms", () => {
  beforeEach(async () => {
    await clearTables();
    await insertTestUsers(db);
    await insertTestRooms(db);
  });

  it("returns all active rooms", async () => {
    const rooms = await getActiveRooms();
    expect(rooms.length).toBeGreaterThan(0);
    expect(rooms[0].streamer).toBeDefined();
  });
});
```

## Test Fixtures

Use fixtures for consistent test data:

```typescript
// In your test
import { insertTestUsers } from "../fixtures/users";

beforeEach(async () => {
  await clearTables();
  await insertTestUsers(db);
});
```

### Available Fixtures

- **users.ts:** 3 test users (Alice, Bob, Carol)
- **rooms.ts:** 5 test rooms (various states)
- **participants.ts:** Participation records
- **relationships.ts:** User relationship data

## Mocking

### Mock External Modules

```typescript
vi.mock("#/lib/auth-guard", () => ({
  getSessionOnServer: vi.fn(() => 
    Promise.resolve({ user: { id: "test-user-id" } })
  ),
  publicRoute: () => {},
}));
```

### Mock Functions

```typescript
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children }) => <a>{children}</a>,
}));
```

### Mock WebSocket

```typescript
const mockSocket = {
  emit: vi.fn(),
  on: vi.fn(),
  join: vi.fn(),
};

vi.mock("#/lib/websocket-context", () => ({
  useWebSocket: () => ({ socket: mockSocket }),
}));
```

## Coverage Requirements

Minimum thresholds (configured in vitest.config.ts):

```typescript
thresholds: {
  statements: 90,
  branches: 90,
  functions: 90,
  lines: 90,
}
```

### Check Coverage

```bash
pnpm test:coverage
```

Output:
```
 % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
---------|----------|---------|---------|-------------------
  94.12  |   91.23  |  92.45  |  94.56  |
```

## Skipped Tests

Some tests are skipped due to framework limitations:

### Rate Limiting Integration (16 tests)
**File:** `tests/integration/rate-limiting.test.ts`
**Reason:** Requires TanStack Start server context
**Alternative:** Unit tests in `tests/unit/rate-limiter.test.ts`

### Room Operations (20 tests)
**File:** `tests/integration/rooms.test.ts`
**Reason:** Server functions return `undefined` in test environment
**Alternative:** Database query tests in other integration tests

See [Integration Test Limitations](./INTEGRATION_TEST_LIMITATIONS.md) for details.

## Common Issues

### "Cannot find module"

Check imports use `#/` alias:
```typescript
// ✅ CORRECT
import { users } from "#/db/schema";

// ❌ WRONG
import { users } from "../src/db/schema";
```

### Database connection failed

```bash
# Ensure PostgreSQL is running
docker compose up -d postgres

# Verify test database exists
docker exec bhayanak-postgres psql -U postgres -l
```

### Test timeout

Increase timeout in vitest.config.ts:
```typescript
testTimeout: 30000,  // 30 seconds
```

### Async test not completing

Ensure all async operations are awaited:
```typescript
// ✅ CORRECT
it("tests async", async () => {
  const result = await fetchData();
  expect(result).toBeDefined();
});

// ❌ WRONG - Missing await
it("tests async", () => {
  const result = fetchData();
  expect(result).toBeDefined();
});
```

## Best Practices

1. **Test behavior, not implementation:**
   ```typescript
   // ✅ Test what user sees
   expect(screen.getByText("Room created")).toBeInTheDocument();
   
   // ❌ Don't test internal state
   expect(component.state.rooms).toHaveLength(1);
   ```

2. **One assertion per test (usually):**
   ```typescript
   // ✅ Clear what failed
   it("shows room name", () => { ... });
   it("shows participant count", () => { ... });
   ```

3. **Use descriptive test names:**
   ```typescript
   // ✅ Clear intent
   it("blocks 4th room creation within 1 minute", () => { ... });
   
   // ❌ Vague
   it("rate limiting works", () => { ... });
   ```

4. **Clean up after tests:**
   ```typescript
   afterEach(() => {
     vi.clearAllMocks();
     cleanup();
   });
   ```

## CI/CD Testing

Tests run automatically on:
- Pull requests
- Pushes to main branch

```yaml
# .github/workflows/test.yml
- name: Run tests
  run: |
    pnpm test:setup
    pnpm test
    pnpm test:coverage
```

## See Also

- [Integration Test Limitations](./INTEGRATION_TEST_LIMITATIONS.md) - Why some tests are skipped
- [Project Structure](./PROJECT_STRUCTURE.md) - Test organization
- [Rate Limiting](./RATE_LIMITING.md) - Rate limit test examples
