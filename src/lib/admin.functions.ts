/**
 * Admin server functions: thin `createServerFn` wrappers over src/server/admin.ts
 * and src/server/admin-users.ts (see rooms.functions.ts for the pattern). Each derives the
 * caller from the session; the server half refuses non-admins. Read through admin.queries.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getDb } from "~/db/client";
import { auth } from "~/lib/auth";
import {
  getAdminDailySeries,
  getAdminLeaderboards,
  getAdminOverview,
  listAdminLiveRooms,
  listAdminRecentRooms,
} from "~/server/admin";
import { banUser, listAdminUsers, unbanUser } from "~/server/admin-users";
import { getLiveHub } from "~/server/live-hub";
import { getCaller } from "~/server/request-caller";
import { toHeaders } from "~/server/session";
import { banUserInput, listAdminUsersInput, unbanUserInput } from "./admin";

export const getAdminOverviewFn = createServerFn({ method: "GET" }).handler(async () =>
  getAdminOverview(getDb(), await getCaller()),
);

export const getAdminDailySeriesFn = createServerFn({ method: "GET" }).handler(async () =>
  getAdminDailySeries(getDb(), await getCaller()),
);

export const listAdminLiveRoomsFn = createServerFn({ method: "GET" }).handler(async () =>
  listAdminLiveRooms(getDb(), await getCaller()),
);

export const listAdminRecentRoomsFn = createServerFn({ method: "GET" }).handler(async () =>
  listAdminRecentRooms(getDb(), await getCaller()),
);

export const getAdminLeaderboardsFn = createServerFn({ method: "GET" }).handler(async () =>
  getAdminLeaderboards(getDb(), await getCaller()),
);

export const listAdminUsersFn = createServerFn({ method: "GET" })
  .validator(listAdminUsersInput)
  .handler(async ({ data }) => listAdminUsers(getDb(), await getCaller(), data));

// Ban and unban act through Better Auth as the calling admin (their session cookie), then on
// the live realtime hub. Built inside each handler, so none of it reaches the client bundle.
export const banUserFn = createServerFn({ method: "POST" })
  .validator(banUserInput)
  .handler(async ({ data }) =>
    banUser(getDb(), await getCaller(), data, {
      auth,
      headers: toHeaders(getRequestHeaders()),
      hub: getLiveHub(),
    }),
  );

export const unbanUserFn = createServerFn({ method: "POST" })
  .validator(unbanUserInput)
  .handler(async ({ data }) =>
    unbanUser(getDb(), await getCaller(), data, {
      auth,
      headers: toHeaders(getRequestHeaders()),
      hub: getLiveHub(),
    }),
  );
