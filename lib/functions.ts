import { createServerFn } from "@tanstack/start";
import {
  getOrCreateRoom,
  fetchRoomDataFromID,
  addUserToRoomIfNotExists,
  removeUserFromRoomByUUID,
} from "./server/db/actions";
import { getAuthSession } from "./server/auth";
import type { User } from "./server/db/schema";

export const getUser = createServerFn({ method: "GET" }).handler(async () => {
  const { user } = await getAuthSession();
  return user;
});

export const createRoom = createServerFn({
  method: "GET",
})
  .validator(
    ({ roomid, roomname, user }: { roomid: string; roomname: string; user: User }) => {
      return {
        roomid,
        roomname,
        user,
      };
    },
  )
  .handler(async (ctx) => {
    // Get existing room or create new room
    const { roomid, roomname, user } = ctx.data;
    return await getOrCreateRoom(roomid, roomname, user);
  });

export const getRoom = createServerFn({
  method: "GET",
})
  .validator(({ roomid }: { roomid: string }) => {
    return {
      roomid: roomid,
    };
  })
  .handler(async (ctx) => {
    // Get existing room or create new room
    const { roomid } = ctx.data;
    return await fetchRoomDataFromID(roomid);
  });

export const addUserToRoom = createServerFn({
  method: "POST",
})
  .validator(({ userUUID, roomUUID }: { userUUID: string; roomUUID: string }) => {
    return {
      userUUID: userUUID,
      roomUUID: roomUUID,
    };
  })
  .handler(async (ctx) => {
    // Get existing room or create new room
    const { userUUID, roomUUID } = ctx.data;
    await addUserToRoomIfNotExists(userUUID, roomUUID);
  });

export const removeUserFromRoom = createServerFn({
  method: "POST",
})
  .validator(({ userUUID, roomUUID }: { userUUID: string; roomUUID: string }) => {
    return {
      userUUID: userUUID,
      roomUUID: roomUUID,
    };
  })
  .handler(async (ctx) => {
    // Get existing room or create new room
    const { userUUID, roomUUID } = ctx.data;
    await removeUserFromRoomByUUID(userUUID, roomUUID);
  });
