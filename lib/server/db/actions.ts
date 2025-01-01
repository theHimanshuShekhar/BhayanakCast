import { eq, and } from "drizzle-orm";
import { db } from ".";
import { room, user, userRoom } from "./schema";

// Add a new room
export const getOrCreateRoom = async (
  roomUUID: string,
  name: string,
  banner_url: string | null = null,
) => {
  // Check if a room with the given name exists
  const existingRoom = await db
    .select()
    .from(room)
    .where(eq(room.uuid, roomUUID))
    .execute();

  // If the room exists, return it
  if (existingRoom.length > 0) {
    return existingRoom[0];
  }

  const [newRoom] = await db
    .insert(room)
    .values({
      name,
      banner_url,
    })
    .returning();

  return newRoom;
};

// Add user to a room when joined
export const addUserToRoomIfNotExists = async (userUUID: string, roomUUID: string) => {
  // Check if the relation already exists
  const existingRelation = await db
    .select()
    .from(userRoom)
    .where(and(eq(userRoom.user_uuid, userUUID), eq(userRoom.room_uuid, roomUUID)))
    .execute();

  if (existingRelation.length > 0) {
    // Relation already exists, return it
    return existingRelation[0];
  }

  // Relation does not exist, create a new one
  const [newRelation] = await db
    .insert(userRoom)
    .values({
      room_uuid: roomUUID,
      user_uuid: userUUID,
      joined_at: new Date(), // Optional: Drizzle should handle defaults
    })
    .returning();

  return newRelation;
};

// Fetch a room with its users using roomID
export const fetchRoomDataFromID = async (roomUUID: string) => {
  const roomWithUsers = await db
    .select({
      room: room,
      users: user,
    })
    .from(userRoom)
    .innerJoin(user, eq(user.uuid, userRoom.user_uuid))
    .innerJoin(room, eq(room.uuid, userRoom.room_uuid))
    .where(eq(room.uuid, roomUUID))
    .execute();

  const result = {
    id: roomWithUsers[0]?.room.id,
    name: roomWithUsers[0]?.room.name,
    uuid: roomWithUsers[0]?.room.uuid,
    banner_url: roomWithUsers[0]?.room.banner_url,
    created_at: roomWithUsers[0]?.room.created_at,
    updated_at: roomWithUsers[0]?.room.updated_at,
    users: roomWithUsers.map(({ users }) => ({
      id: users.id,
      name: users.name,
      uuid: users.uuid,
      avatar_url: users.avatar_url,
      email: users.email,
    })),
  };

  return result;
};

// Fetch a room with its users using roomName
export const fetchRoomDataFromName = async (roomName: string) => {
  const roomWithUsers = await db
    .select({
      room: room,
      users: user,
    })
    .from(userRoom)
    .innerJoin(user, eq(user.uuid, userRoom.user_uuid))
    .innerJoin(room, eq(room.uuid, userRoom.room_uuid))
    .where(eq(room.name, roomName))
    .execute();

  const result = {
    id: roomWithUsers[0]?.room.id,
    name: roomWithUsers[0]?.room.name,
    uuid: roomWithUsers[0]?.room.uuid,
    banner_url: roomWithUsers[0]?.room.banner_url,
    created_at: roomWithUsers[0]?.room.created_at,
    updated_at: roomWithUsers[0]?.room.updated_at,
    users: roomWithUsers.map(({ users }) => ({
      id: users.id,
      name: users.name,
      avatar_url: users.avatar_url,
      email: users.email,
    })),
  };

  return result;
};

// Fetch all current rooms with joined users
export const fetchRooms = async () => {
  const roomsWithUsers = await db
    .select({
      room: room,
      user: user,
    })
    .from(userRoom)
    .innerJoin(user, eq(user.uuid, userRoom.user_uuid))
    .innerJoin(room, eq(room.uuid, userRoom.room_uuid))
    .execute();

  // Group users by room
  const roomsMap = new Map<
    number,
    {
      id: number;
      uuid: string;
      name: string | null;
      banner_url: string | null;
      created_at: Date;
      updated_at: Date | null;
      users: Array<{
        id: number;
        uuid: string;
        name: string | null;
        avatar_url: string | null;
        email: string;
      }>;
    }
  >();

  for (const { room, user } of roomsWithUsers) {
    if (!roomsMap.has(room.id)) {
      roomsMap.set(room.id, {
        id: room.id,
        uuid: room.uuid,
        name: room.name,
        banner_url: room.banner_url,
        created_at: room.created_at,
        updated_at: room.updated_at,
        users: [],
      });
    }

    roomsMap.get(room.id)?.users.push({
      id: user.id,
      uuid: user.uuid,
      name: user.name,
      avatar_url: user.avatar_url,
      email: user.email,
    });
  }

  return Array.from(roomsMap.values());
};
