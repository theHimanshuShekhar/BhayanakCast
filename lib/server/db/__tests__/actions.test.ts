import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOrCreateRoom,
  setRoomStreamer,
  addUserToRoomIfNotExists,
  fetchRoomDataFromID,
  fetchRoomDataFromName,
  fetchRooms,
  removeUserFromRoomByUUID,
  removeUserFromAllRooms,
} from "../actions";
import { db } from "..";
import { userRoom as UserRoom } from "../schema";

// Mock the database client
vi.mock("..");

const mockUser = {
  id: 1,
  uuid: "user-123",
  name: "Test User",
  email: "test@example.com",
  avatar_url: "https://example.com/avatar.jpg",
};

const mockRoom = {
  id: 1,
  uuid: "room-123",
  name: "Test Room",
  banner_url: "https://example.com/banner.jpg",
  streamer: "user-123",
  created_at: new Date(),
  updated_at: new Date(),
};

describe("Database Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getOrCreateRoom", () => {
    it("should return existing room if found", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([mockRoom]),
      } as any);

      const result = await getOrCreateRoom(mockRoom.uuid, mockRoom.name, mockUser);
      expect(result).toEqual(mockRoom);
    });

    it("should create new room if not found", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
      } as any);

      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockRoom]),
      } as any);

      const result = await getOrCreateRoom(mockRoom.uuid, mockRoom.name, mockUser);
      expect(result).toEqual(mockRoom);
    });
  });

  describe("setRoomStreamer", () => {
    it("should set room streamer", async () => {
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockRoom]),
      } as any);

      const result = await setRoomStreamer(mockUser.uuid, mockRoom.uuid);
      expect(result).toEqual(mockRoom);
    });
  });

  describe("addUserToRoomIfNotExists", () => {
    it("should return existing relation if found", async () => {
      const mockRelation = { user_uuid: mockUser.uuid, room_uuid: mockRoom.uuid };

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([mockRelation]),
      } as any);

      const result = await addUserToRoomIfNotExists(mockUser.uuid, mockRoom.uuid);
      expect(result).toEqual(mockRelation);
    });

    it("should create new relation if not found", async () => {
      const mockRelation = { user_uuid: mockUser.uuid, room_uuid: mockRoom.uuid };

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
      } as any);

      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockRelation]),
      } as any);

      const result = await addUserToRoomIfNotExists(mockUser.uuid, mockRoom.uuid);
      expect(result).toEqual(mockRelation);
    });
  });

  describe("fetchRoomDataFromID", () => {
    it("should fetch room data with users", async () => {
      const mockRoomWithUsers = [
        {
          room: mockRoom,
          users: mockUser,
        },
      ];

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue(mockRoomWithUsers),
      } as any);

      const result = await fetchRoomDataFromID(mockRoom.uuid);
      expect(result).toEqual({
        ...mockRoom,
        users: [mockUser],
      });
    });
  });

  describe("fetchRoomDataFromName", () => {
    it("should fetch room data by name", async () => {
      const mockRoomWithUsers = [
        {
          room: mockRoom,
          users: mockUser,
        },
      ];

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue(mockRoomWithUsers),
      } as any);

      const result = await fetchRoomDataFromName(mockRoom.name);
      expect(result.name).toBe(mockRoom.name);
      expect(result.users).toHaveLength(1);
    });
  });

  describe("fetchRooms", () => {
    it("should fetch all rooms with users", async () => {
      const mockRoomsWithUsers = [
        {
          room: {
            id: 1,
            uuid: "c42a9854-ad6e-4dbb-b733-20592cd5cf5b",
            name: "Bhayanak Room",
            banner_url: null,
            streamer: "5db9ee5f-17d1-4804-9470-73dc4db75419",
            created_at: new Date("2025-01-25T18:34:30.743Z"),
            updated_at: new Date("2025-01-25T18:34:30.743Z"),
          },
          users: [
            {
              id: 1,
              uuid: "5db9ee5f-17d1-4804-9470-73dc4db75419",
              name: "Goti",
              avatar_url:
                "https://cdn.discordapp.com/avatars/199167307241488384/676b3b8076b3ebb3a6f8011a0fb4938d.png",
              email: "hemanshoe.shekhar@gmail.com",
              created_at: new Date("2025-01-25T18:58:55.981Z"),
              updated_at: new Date("2025-01-25T18:58:55.981Z"),
              setup_at: null,
            },
          ],
        },
        {
          room: {
            id: 3,
            uuid: "c42a2854-ad6e-4dbd-b733-20492cd5cf5b",
            name: "Test Room",
            banner_url: null,
            streamer: "5db9ee5f-17d1-4804-9470-73dc4db75419",
            created_at: new Date("2025-01-25T18:34:30.743Z"),
            updated_at: new Date("2025-01-25T18:34:30.743Z"),
          },
          users: [],
        },
      ];

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue(mockRoomsWithUsers),
      } as any);

      const result = await fetchRooms();

      expect(result).toHaveLength(2);
      expect(result[0].room.name).toBe("Bhayanak Room");
      expect(result[0].users[0]).toHaveLength(1); // Expect 1 user
      expect(result[1].room.name).toBe("Test Room");
      expect(result[1].users[0]).toHaveLength(0); // Expect 1 user
    });

    it("should return empty array when no rooms exist", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
      } as any);

      const result = await fetchRooms();
      expect(result).toEqual([]);
    });
  });

  describe("removeUserFromRoomByUUID", () => {
    it("should remove user from specific room", async () => {
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([{ affected: 1 }]),
      } as any);

      await removeUserFromRoomByUUID(mockUser.uuid, mockRoom.uuid);
      expect(db.delete).toHaveBeenCalledWith(UserRoom);
    });
  });

  describe("removeUserFromAllRooms", () => {
    it("should remove user from all rooms", async () => {
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([{ affected: 1 }]),
      } as any);

      await removeUserFromAllRooms(mockUser.uuid);
      expect(db.delete).toHaveBeenCalledWith(UserRoom);
    });
  });
});
