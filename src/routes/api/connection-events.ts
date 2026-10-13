import { createFileRoute } from "@tanstack/react-router";
import { beaconResponse, getConnectionEventService } from "~/server/connection-events";
import { callerFromSession, getSessionFromRequest } from "~/server/session";

// The same report as `reportConnectionFn`, for a page that is closing. `navigator.sendBeacon`
// can't call a server function (its URL and body are the framework's), but it does send a
// same-origin POST with the session cookie, which is all this route needs to know who is calling
// (ADR 3 addendum on the room timeline). The checks are in `beaconResponse`.
export const Route = createFileRoute("/api/connection-events")({
  server: {
    handlers: {
      POST: ({ request }) =>
        beaconResponse(request, {
          caller: async (req) => callerFromSession(await getSessionFromRequest(req)),
          service: getConnectionEventService(),
        }),
    },
  },
});
