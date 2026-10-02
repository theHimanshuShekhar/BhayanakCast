import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "~/db/client";
import { healthResponse } from "~/server/health";

// The app container's healthcheck (docs/deploy.md). It sits outside `/api/auth`, so Better Auth's
// rate limiter never sees it, and it needs no session. The security headers server.prod.ts adds to
// every response (CSP, nosniff) are harmless on JSON, and its own `no-store` is kept as it is.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => healthResponse(getDb()),
    },
  },
});
