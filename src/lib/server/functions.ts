import { createServerFn } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auth } from "./auth";
import { db } from "./db";
import { room, user } from "./schema";

const PermanentlyAvailable = ["Bhayanak", "SnapeGang", "Movie Time", "Chill Zone"];

// get posthog data
export const getPostHogData = createServerFn({ method: "GET" }).handler(async () => {
  // Check if the environment variables are set
  if (
    !process.env.REACT_APP_PUBLIC_POSTHOG_KEY ||
    !process.env.REACT_APP_PUBLIC_POSTHOG_HOST
  ) {
    throw new Error("PostHog environment variables are not set");
  }
  // Check if the environment variables are valid
  const posthogData = {
    apiKey: process.env.REACT_APP_PUBLIC_POSTHOG_KEY,
    api_host: process.env.REACT_APP_PUBLIC_POSTHOG_HOST,
  };

  return posthogData;
});

// get server url
export const getServerURL = createServerFn({ method: "GET" }).handler(() => {
  const request = getWebRequest();
  // get if the request is secure
  const isSecure = request?.headers.get("x-forwarded-proto") === "https";
  const protocol = isSecure ? "https" : "http";
  const host = request?.headers.get("x-forwarded-host") || request?.headers.get("host");
  const port = request?.headers.get("x-forwarded-port") || request?.headers.get("port");
  const serverURL = `${host}${port ? `:${port}` : ""}`;
  return { serverURL, protocol };
});

// get user from session
export const getUser = createServerFn({ method: "GET" }).handler(async () => {
  const headers = new Headers(getWebRequest()?.headers ?? {});
  const session = await auth.api.getSession({ headers });

  return session?.user || null;
});

// get rooms with viewers and streamer
export const getRoomsFromDB = createServerFn({ method: "GET" }).handler(
  async () => await getRoomsWithViewers(),
);

async function getRoomsWithViewers() {
  const rooms = await db.select().from(room).orderBy(room.createdAt);

  // get streamer for each room
  const roomsWithViewers = await Promise.all(
    rooms.map(async (singleRoom) => {
      const viewers = await db.select().from(user).where(eq(user.roomId, singleRoom.id));
      const streamer = await db
        .select()
        .from(user)
        .where(eq(user.id, singleRoom.streamer))
        .limit(1);
      return {
        ...singleRoom,
        viewers: viewers,
        streamer: streamer[0],
      };
    }),
  );

  return roomsWithViewers;
}

// get room with viewers and streamer by id
export const roomById = createServerFn({ method: "GET" })
  .validator((roomid: string) => roomid)
  .handler(async (ctx) => {
    const roomid = ctx.data;
    const roomData = await getRoomWithViewers(roomid); // renamed variable
    return roomData;
  });

async function getRoomWithViewers(roomid: string) {
  const requestedRoom = await db.select().from(room).where(eq(room.id, roomid));
  if (requestedRoom === undefined || requestedRoom.length === 0) {
    return null;
  }
  const viewers = await db.select().from(user).where(eq(user.roomId, roomid));
  const streamer = await db
    .select()
    .from(user)
    .where(eq(user.id, requestedRoom[0].streamer));
  return { ...requestedRoom[0], viewers, streamer: streamer[0] ?? null };
}

// get user by id
export const getUserById = createServerFn({ method: "GET" })
  .validator((userid: string) => userid)
  .handler(async (ctx) => {
    const userid = ctx.data;
    const user = await getUserData(userid);
    return user;
  });

async function getUserData(userid: string) {
  const userData = await db.select().from(user).where(eq(user.id, userid)).limit(1);
  return userData[0];
}

// add viewer to room
export const addViewerToRoom = createServerFn({ method: "POST" })
  .validator((data: { roomId: string; userId: string }) => data)
  .handler(async (ctx) => {
    const { roomId, userId } = ctx.data;
    await db.update(user).set({ roomId }).where(eq(user.id, userId));
    return { success: true };
  });

// remove viewer from room
export const removeViewerFromRoom = createServerFn({ method: "POST" })
  .validator((userId: string) => userId)
  .handler(async (ctx) => {
    const userId = ctx.data;
    const userFromDB = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!userFromDB[0].roomId) {
      return { success: false, message: "User is not in a room" };
    }
    const leavingRoomID = userFromDB[0].roomId;
    await db.update(user).set({ roomId: null }).where(eq(user.id, userId));

    isRoomEmpty(leavingRoomID).then(async (isEmpty) => {
      if (isEmpty) {
        if (PermanentlyAvailable.includes(leavingRoomID)) {
          console.log(`Room ${leavingRoomID} is permanently available, not deleting`);
          return;
        }
        console.log("Room is empty, deleting room in 5 minutes");
        // delete room after 5 minutes
        setTimeout(
          async () => {
            const isEmptyNow = await isRoomEmpty(leavingRoomID);
            if (!isEmptyNow) return;
            await db
              .delete(room)
              .where(eq(room.id, leavingRoomID))
              .then(() => {
                console.log("Room deleted");
              });
          },
          5 * 60 * 1000, // 5 minutes
        );
      } else {
        const streamer = await db
          .select()
          .from(room)
          .where(eq(room.id, leavingRoomID))
          .then((data) => data[0].streamer);
        if (streamer === userId) {
          console.log("Streamer left the room, updating streamer");
          updateRoomStreamer(leavingRoomID);
        }
      }
    });

    return {
      status: "success",
      message: "User removed from room",
      roomId: leavingRoomID,
    };
  });

// check if room empty
async function isRoomEmpty(roomId: string) {
  // get room user count
  const userCount = await db
    .select()
    .from(user)
    .where(eq(user.roomId, roomId))
    .then((data) => data.length);

  if (userCount === 0) {
    return true;
  }
  return false;
}

// get users from db
export const getUsersFromDB = createServerFn({ method: "GET" }).handler(async () => {
  const users = await db.select().from(user);
  return users;
});

export const createRoom = createServerFn({ method: "POST" })
  .validator((data: { name: string; description: string; userId: string }) => data)
  .handler(async (ctx) => {
    const { name, description, userId } = ctx.data;
    const id = randomUUID();
    const roomData = {
      id,
      name,
      description,
      streamer: userId,
    };
    const roomId = await db
      .insert(room)
      .values(roomData)
      .returning()
      .then((data) => data[0].id);
    return roomId;
  });

async function updateRoomStreamer(leavingRoomID: string) {
  console.log("Updating room streamer");

  // Find remaining viewers in the room
  const viewers = await db.select().from(user).where(eq(user.roomId, leavingRoomID));

  if (viewers.length === 0) {
    // Nothing to do if no viewers remain
    return;
  }

  // Choose a new streamer (e.g. the first one)
  const newStreamerId = viewers[0].id;

  // Update the room's streamer field
  await db
    .update(room)
    .set({ streamer: newStreamerId })
    .where(eq(room.id, leavingRoomID));
}
