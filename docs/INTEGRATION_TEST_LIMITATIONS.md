# Integration Test Limitations

## Skipped Tests

`tests/integration/rate-limiting.test.ts` — **16 tests skipped**

### Why

TanStack Start server functions (`createServerFn`) require a full TanStack Start runtime:
- Hono server runtime + request/response context
- Vite plugin build-time transformations
- Server function registry

In Vitest, server functions return `undefined` instead of executing.

### Alternative Coverage

| Layer | Tests | What's covered |
|-------|-------|----------------|
| Unit | 35 rate-limiter tests | Core algorithm (sliding window, limits, backends) |
| WebSocket | 27 tests | Rate limiting enforced in WS handlers |
| E2E | 23 Playwright tests | Full user flows including rate-limit scenarios |

### When to Re-enable

When TanStack Start releases official testing utilities. Track: [TanStack Start releases](https://github.com/TanStack/router/releases).

### Manual Testing

```bash
pnpm dev
# 1. Create 4 rooms quickly with the same user
# 2. Verify 4th creation shows rate limit error
# 3. Wait 60 seconds, verify can create again
```
