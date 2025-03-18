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
    console.log(room);
    return room;
  });

export const getOrCreateRoom = async ({
  roomid,
  userid,
}: {
  roomid: string;
  userid: string;
}) => {
  // Check if room exists
  const existingRoom = await db
    .select()
    .from(room)
    .where(eq(room.id, roomid))
    .limit(1)
    .execute();

  if (existingRoom.length > 0) {
    console.info("Existing room found");
    await addUserToRoom({ roomid, userid });
    return existingRoom;
  }

  console.info("Creating new room");

  // Create new room with user as streamer
  const newRoom = await db
    .insert(room)
    .values({
      id: roomid,
      name: roomid,
      description: "Some Description",
      image: null,
      streamer: userid,
    })
    .returning()
    .execute()
    .catch(() => {
      console.error("Failed to create new room");
      return new Error("Failed to create new room");
    });

  await addUserToRoom({ roomid, userid });

  return newRoom;
};

export const addUserToRoom = async ({
  roomid,
  userid,
}: {
  roomid: string;
  userid: string;
}) => {
  // Add room to user
  db.update(user)
    .set({ joinedRoomId: roomid })
    .where(eq(user.id, userid))
    .execute()
    .catch(() => console.error("Failed to add room to user"));
};

export const getRoomsFromDB = createServerFn({ method: "GET" }).handler(
  async () => await getRooms(),
);

export const getRooms = async () => {
  return await db.select().from(room).execute();
};
