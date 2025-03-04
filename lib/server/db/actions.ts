import { eq, and } from "drizzle-orm";
import { db } from ".";
import { room, type User, user, userRoom, type Room, type UserRoom } from "./schema";

// Add a new room
export const getOrCreateRoom = async (
  roomUUID: Room["uuid"],
  name: Room["name"],
  user: User,
  banner_url: Room["banner_url"] | null = null,
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
      uuid: roomUUID,
      name,
      banner_url,
      streamer: user.uuid,
    })
    .returning();

  return newRoom;
};

export const setRoomStreamer = async (
  userUUID: UserRoom["user_uuid"],
  roomUUID: UserRoom["room_uuid"],
) => {
  console.log(`Adding user: ${userUUID} as streamer of room: ${roomUUID}`);

  const [updatedRoom] = await db
    .insert(room)
    .values({
      streamer: userUUID,
    })
    .returning();

  return updatedRoom;
};

// Add user to a room when joined
export const addUserToRoomIfNotExists = async (
  userUUID: UserRoom["user_uuid"],
  roomUUID: UserRoom["room_uuid"],
) => {
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
    })
    .returning();

  return newRelation;
};

// Fetch a room with its users using roomID
export const fetchRoomDataFromID = async (roomUUID: Room["uuid"]) => {
  const roomWithUsers = await db
    .select({ room: room, users: user })
    .from(room)
    .leftJoin(userRoom, eq(userRoom.room_uuid, room.uuid))
    .leftJoin(user, eq(user.uuid, userRoom.user_uuid))
    .where(eq(room.uuid, roomUUID))
    .execute();

  const result = {
    id: roomWithUsers[0]?.room.id,
    name: roomWithUsers[0]?.room.name,
    uuid: roomWithUsers[0]?.room.uuid,
    banner_url: roomWithUsers[0]?.room.banner_url,
    created_at: roomWithUsers[0]?.room.created_at,
    updated_at: roomWithUsers[0]?.room.updated_at,
    users: roomWithUsers.map(({ users }) => users),
    streamer: roomWithUsers[0]?.room.streamer,
  };

  return result;
};

// Fetch a room with its users using roomName
export const fetchRoomDataFromName = async (roomName: Room["name"]) => {
  const roomWithUsers = await db
    .select({
      room: room,
      users: user,
    })
    .from(userRoom)
    .innerJoin(user, eq(user.uuid, userRoom.user_uuid))
    .innerJoin(room, eq(room.uuid, userRoom.room_uuid))
    .where(eq(room.name, roomName as string))
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

export const fetchRooms = async () => {
  const roomsWithUsers = await db
    .select({
      room: room,
      users: user,
    })
    .from(room)
    .leftJoin(userRoom, eq(room.uuid, userRoom.room_uuid))
    .leftJoin(user, eq(userRoom.user_uuid, user.uuid))
    .execute();

  if (!Array.isArray(roomsWithUsers) || roomsWithUsers.length === 0) {
    return [];
  }

  // Group the users by room for easier consumption
  const groupedRooms: { [key: number]: { room: Room; users: User[] } } =
    roomsWithUsers.reduce(
      (
        acc: { [key: number]: { room: Room; users: User[] } },
        { room: roomData, users: userData },
      ) => {
        const roomId = roomData.id;

        if (!acc[roomId]) {
          acc[roomId] = {
            room: roomData,
            users: [],
          };
        }

        if (userData) {
          acc[roomId].users.push(userData);
        }

        return acc;
      },
      {},
    );

  return Object.values(groupedRooms);
};

export const removeUserFromRoomByUUID = async (user_uuid: string, room_uuid: string) => {
  return await db
    .delete(userRoom)
    .where(and(eq(userRoom.user_uuid, user_uuid), eq(userRoom.room_uuid, room_uuid)))
    .execute();
};

export const removeUserFromAllRooms = async (user_uuid: string) => {
  return await db.delete(userRoom).where(eq(userRoom.user_uuid, user_uuid)).execute();
};
