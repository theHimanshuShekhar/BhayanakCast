/**
 * Room server functions: thin `createServerFn` wrappers, safe to import anywhere
 * (the build swaps handlers for RPC stubs on the client). Each one validates its
 * input with zod, derives the caller from the session (`getCaller`) and hands
 * both to src/server/rooms.ts. Read through the query options in
 * rooms.queries.ts rather than calling the reads directly.
 */
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/db/client";
import { getCaller } from "~/server/request-caller";
import { createRoom, getLiveRoom, listLiveRooms } from "~/server/rooms";
import { createRoomInput, roomIdInput } from "./rooms";

export const createRoomFn = createServerFn({ method: "POST" })
  .validator(createRoomInput)
  .handler(async ({ data }) => createRoom(getDb(), await getCaller(), data));

export const listLiveRoomsFn = createServerFn({ method: "GET" }).handler(async () =>
  listLiveRooms(getDb(), await getCaller()),
);

export const getLiveRoomFn = createServerFn({ method: "GET" })
  .validator(roomIdInput)
  .handler(async ({ data }) => getLiveRoom(getDb(), await getCaller(), data.roomId));
