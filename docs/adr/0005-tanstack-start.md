# 5. TanStack Start as the app framework

Date: 2026-09-27 · Status: accepted

## Decision
Use TanStack Start (React, TanStack Router, server functions, Vite). Routes: `/`, `/room/$roomId`, `/profile/$username`, `/past/$roomId`, `/admin`. The WebSocket endpoint (ADR 4) is attached to the same Node HTTP server through a custom production server entry.

## Consequences
- The design's React/Tailwind JSX ports almost directly.
- Server functions cover normal DB reads/writes; the WebSocket covers live room traffic.
- It is one deployable Node process.
