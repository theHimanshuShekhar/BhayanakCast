import { createServerFn } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { room, user } from "./schema";

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
        streamer: {
          id: string;
          name: string;
          image: string | null;
        } | null;
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
    await addUserToRoom({ roomid, userid });
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
  }

  await db
    .select({
      id: room.id,
      name: room.name,
      description: room.description,
      image: room.image,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      streamer: {
        id: user.id,
        name: user.name,
        image: user.image,
      },
    })
    .from(room)
    .leftJoin(user, eq(room.streamer, user.id))
    .where(eq(room.id, roomid))
    .limit(1)
    .execute();

  await addUserToRoom({ roomid, userid });

  return requestedRoom;
};

const addUserToRoom = async ({ roomid, userid }: { roomid: string; userid: string }) => {
  // Add room to user
  db.update(user)
    .set({ joinedRoomId: roomid })
    .where(eq(user.id, userid))
    .execute()
    .catch(() => console.error("Failed to add room to user"));
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
