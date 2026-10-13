import { createFileRoute } from "@tanstack/react-router";
import { requireSignedIn, SignInRequiredError } from "~/server/caller";
import { getConnectionEventService, readBeacon } from "~/server/connection-events";
import { callerFromSession, getSessionFromRequest } from "~/server/session";
import { isSameOrigin } from "~/server/thumbnails";

const fail = (status: number, error: string) => Response.json({ error }, { status });

// The same report as `reportConnectionFn`, for a page that is closing. `navigator.sendBeacon`
// can't call a server function (its URL and body are the framework's), but it does send a
// same-origin POST with the session cookie, which is all this route needs to know who is calling
// (ADR 3 addendum on the room timeline).
export const Route = createFileRoute("/api/connection-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) return fail(403, "Forbidden");
        try {
          const caller = callerFromSession(await getSessionFromRequest(request));
          requireSignedIn(caller);
          const read = await readBeacon(request);
          if (!read.ok) return fail(read.status, read.error);
          return Response.json(await getConnectionEventService().record(caller, read.input));
        } catch (error) {
          if (error instanceof SignInRequiredError) return fail(401, error.message);
          throw error;
        }
      },
    },
  },
});
