# Documentation

## Directories

- [`design/`](./design/) — extracted visual prototype, screenshots, and analysis of how the prototype maps to canonical product decisions.
- [`adr/`](./adr/) — architecture decision records for hard-to-reverse product and technical choices.
- [`configuration.md`](./configuration.md) — required environment variable contract and deployment boundaries.
- [`schema.md`](./schema.md) — v1 product table names, critical constraints, indexes, and live-only state boundaries.
- [`drizzle-schema.md`](./drizzle-schema.md) — exact Drizzle column types, constraints, indexes, and migration order.
- [`observability.md`](./observability.md) — structured logging scope and sensitive-data exclusions.
- [`implementation-plan.md`](./implementation-plan.md) — vertical-slice build order and per-slice expectations.
- [`testing.md`](./testing.md) — Playwright Chromium e2e catalog plus Vitest integration/unit coverage boundaries.
- [`socket-events.md`](./socket-events.md) — exact Socket.IO event names, payloads, ack shape, broadcasts, and stable error codes.
- [`routes.md`](./routes.md) — exact TanStack Start page/API route map and non-route decisions.

## Source of truth order

1. [`../CONTEXT.md`](../CONTEXT.md) for product language.
2. [`adr/`](./adr/) for architectural/product decisions.
3. [`design/`](./design/) for visual direction and prototype reference.

If the prototype conflicts with `CONTEXT.md` or an ADR, the glossary/ADR wins.
