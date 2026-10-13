/**
 * Connection events server function (ADR 3 addendum on the room timeline): a thin
 * `createServerFn` wrapper over src/server/connection-events.ts, for signed-in callers only (see
 * ./quality-telemetry.functions.ts for the pattern). A page closing sends the same report to
 * `/api/connection-events` instead (src/routes/api/connection-events.ts), as a beacon can't call
 * a server function.
 */
import { createServerFn } from "@tanstack/react-start";
import { getConnectionEventService } from "~/server/connection-events";
import { getCaller } from "~/server/request-caller";
import { reportConnectionEventsInput } from "./connection-events";

/** Store the caller's events about their connections in the room they are in (or joining). */
export const reportConnectionFn = createServerFn({ method: "POST" })
  .validator(reportConnectionEventsInput)
  .handler(async ({ data }) => getConnectionEventService().record(await getCaller(), data));
