/**
 * Recap server functions: thin `createServerFn` wrappers over src/server/recaps.ts
 * (see rooms.functions.ts for the pattern). Read through recaps.queries.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/db/client";
import { getRecap } from "~/server/recaps";
import { getCaller } from "~/server/request-caller";
import { roomIdInput } from "./rooms";

export const getRecapFn = createServerFn({ method: "GET" })
  .validator(roomIdInput)
  .handler(async ({ data }) => getRecap(getDb(), await getCaller(), data.roomId));
