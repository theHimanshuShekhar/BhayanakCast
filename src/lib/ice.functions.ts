/**
 * ICE server functions (ADR 3): thin `createServerFn` wrappers over src/server/ice.ts, for
 * signed-in callers only. POST, so credentials are never cached along the way.
 */
import { createServerFn } from "@tanstack/react-start";
import { getIceService } from "~/server/ice";
import { getCaller } from "~/server/request-caller";
import { iceReport } from "./ice";
import { roomIdInput } from "./rooms";

/**
 * STUN for the caller, plus short-lived TURN credentials if they may enter the live room
 * `roomId`, and when to ask again.
 */
export const getIceServersFn = createServerFn({ method: "POST" })
  .validator(roomIdInput)
  .handler(async ({ data }) => getIceService().serversFor(await getCaller(), data.roomId));

/** Log that one of the caller's pairs relays or failed (anonymised candidate types). */
export const reportIceFn = createServerFn({ method: "POST" })
  .validator(iceReport)
  .handler(async ({ data }) => {
    getIceService().report(await getCaller(), data);
  });
