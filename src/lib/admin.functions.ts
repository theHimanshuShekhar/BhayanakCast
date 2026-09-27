/**
 * Admin server functions: thin `createServerFn` wrappers over src/server/admin.ts
 * (see rooms.functions.ts for the pattern). Each derives the caller from the session;
 * the server half refuses non-admins. Read through admin.queries.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/db/client";
import {
  getAdminDailySeries,
  getAdminLeaderboards,
  getAdminOverview,
  listAdminLiveRooms,
  listAdminRecentRooms,
} from "~/server/admin";
import { getCaller } from "~/server/request-caller";

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
