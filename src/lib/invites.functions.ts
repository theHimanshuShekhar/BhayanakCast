/**
 * Invite server functions: thin `createServerFn` wrappers over src/server/invites.ts. Each
 * validates its input with zod and hands it to the server half; `getInviteTokenFn` and
 * `regenerateInviteTokenFn` derive the caller from the session. Read the invite through the query options in invites.queries.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/db/client";
import { getInviteToken, regenerateInviteToken, resolveInvite } from "~/server/invites";
import { getLiveHub } from "~/server/live-hub";
import { getCaller } from "~/server/request-caller";
import { inviteTokenInput } from "./invites";
import { roomIdInput } from "./rooms";

export const resolveInviteFn = createServerFn({ method: "GET" })
  .validator(inviteTokenInput)
  .handler(async ({ data }) => resolveInvite(getDb(), data.inviteToken));

export const getInviteTokenFn = createServerFn({ method: "GET" })
  .validator(roomIdInput)
  .handler(async ({ data }) => getInviteToken(getDb(), await getCaller(), data.roomId));

export const regenerateInviteTokenFn = createServerFn({ method: "POST" })
  .validator(roomIdInput)
  .handler(async ({ data }) =>
    regenerateInviteToken(getDb(), await getCaller(), data.roomId, getLiveHub()),
  );
