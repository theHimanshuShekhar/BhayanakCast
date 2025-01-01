import { createServerFn } from "@tanstack/start";
import {
  getOrCreateRoom,
  fetchRoomDataFromID,
  addUserToRoomIfNotExists,
} from "./server/db/actions";

export const createRoom = createServerFn({
  method: "GET",
})
  .validator(({ roomid, roomname }: { roomid: string; roomname: string }) => {
    return {
      roomid: roomid,
      roomname: roomname,
    };
  })
  .handler(async (ctx) => {
    // Get existing room or create new room
    const { roomid, roomname } = ctx.data;
    return await getOrCreateRoom(roomid, roomname);
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
