/**
 * ICE server functions (ADR 3): thin `createServerFn` wrappers over src/server/ice.ts, for
 * signed-in callers only. POST, so credentials are never cached along the way.
 */
import { createServerFn } from "@tanstack/react-start";
import { getIceService } from "~/server/ice";
import { getCaller } from "~/server/request-caller";
import { iceReport } from "./ice";

/** STUN plus short-lived TURN credentials for the caller, and when to ask again. */
export const getIceServersFn = createServerFn({ method: "POST" }).handler(async () =>
  getIceService().serversFor(await getCaller()),
);

/** Log that one of the caller's pairs relays or failed (anonymised candidate types). */
export const reportIceFn = createServerFn({ method: "POST" })
  .validator(iceReport)
  .handler(async ({ data }) => {
    getIceService().report(await getCaller(), data);
  });
