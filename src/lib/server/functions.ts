import { createServerFn } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { room, user } from "./schema";

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

export const getUser = createServerFn({ method: "GET" }).handler(async () => {
  const headers = new Headers(getWebRequest()?.headers ?? {});
  const session = await auth.api.getSession({ headers });

  return session?.user || null;
});

export const getUserFromDB = createServerFn({ method: "GET" })
  .validator((userid: string) => userid)
  .handler(async (ctx) => {
    const userid = ctx.data;
    const userFromDb = await db
      .select()
      .from(user)
      .where(eq(user.id, userid))
      .limit(1)
      .execute();

    return userFromDb;
  });

export const getRoomFromDB = createServerFn({ method: "GET" })
  .validator(({ roomid, userid }: { roomid: string; userid: string }) => {
    return { roomid, userid };
  })
  .handler(async (ctx) => {
    const { roomid, userid } = ctx.data;
    const room = await getOrCreateRoom({ roomid, userid });
    return room;
  });

const getOrCreateRoom = async ({
  roomid,
  userid,
}: {
  roomid: string;
  userid: string;
}) => {
  let requestedRoom:
    | {
        id: string;
        name: string;
        description: string | null;
        image: string | null;
        createdAt: Date;
        updatedAt: Date;
        streamer: typeof user.$inferSelect | null;
      }
    | undefined;

  // Check if room exists
  const existingRoom = await db
    .select({
      id: room.id,
      name: room.name,
      description: room.description,
      image: room.image,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      streamer: user,
    })
    .from(room)
    .leftJoin(user, eq(room.streamer, user.id))
    .where(eq(room.id, roomid))
    .limit(1)
    .execute();

  if (existingRoom.length > 0) {
    requestedRoom = existingRoom[0];
  } else {
    // Create new room with user as streamer
    await db
      .insert(room)
      .values({
        id: roomid,
        name: roomid,
        description: "Some Description",
        image: null,
        streamer: userid,
      })
      .execute()
      .catch(() => {
        console.error("Failed to create new room");
      });

    requestedRoom = (
      await db
        .select({
          id: room.id,
          name: room.name,
          description: room.description,
          image: room.image,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
          streamer: user,
        })
        .from(room)
        .leftJoin(user, eq(room.streamer, user.id))
        .where(eq(room.id, roomid))
        .limit(1)
        .execute()
    )[0];
  }

  await addUserToRoom({ roomid, userid });

  // Get all viewers of room
  const viewers = await db
    .select()
    .from(user)
    .where(eq(user.joinedRoomId, roomid))
    .execute();

  const returnedRoom = {
    ...requestedRoom,
    viewers,
  };

  return returnedRoom;
};

const addUserToRoom = async ({ roomid, userid }: { roomid: string; userid: string }) => {
  // Add room to user only if not already in a room
  await db
    .select()
    .from(user)
    .where(eq(user.id, userid))
    .limit(1)
    .then((users) => {
      const userdata = users[0];
      if (userdata.joinedRoomId !== roomid) {
        db.update(user)
          .set({ joinedRoomId: roomid })
          .where(eq(user.id, userdata.id))
          .execute()
          .catch(() => console.error("Failed to add room to user"));
      }
    });
};

export const removeUserFromRoomDB = createServerFn({
  method: "GET",
})
  .validator(({ roomid, userid }: { roomid: string; userid: string }) => {
    return { roomid, userid };
  })
  .handler(async (ctx) => {
    const { roomid, userid } = ctx.data;
    await removeUserFromRoom({ roomid, userid }).then(() => {
      return {
        message: "Removed user from room",
      };
    });
  });

const removeUserFromRoom = async ({ userid }: { roomid: string; userid: string }) => {
  // Add room to user
  db.update(user)
    .set({ joinedRoomId: null })
    .where(eq(user.id, userid))
    .execute()
    .catch(() => console.error("Failed to remove user from room"));
};

export const getRoomsFromDB = createServerFn({ method: "GET" }).handler(
  async () => await getRooms(),
);

const getRooms = async () => {
  return await db
    .select({
      id: room.id,
      name: room.name,
      description: room.description,
      image: room.image,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      streamer: user,
    })
    .from(room)
    .leftJoin(user, eq(room.streamer, user.id))
    .execute();
};
