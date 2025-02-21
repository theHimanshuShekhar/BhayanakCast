import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import { io as Client, type Socket } from "socket.io-client";
import { httpServer as Server } from "./ws";

// Add environment validation
beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required for tests");
  }
});

interface MockUser {
  uuid: string;
  name: string;
  email: string;
}

interface RoomData {
  uuid: string;
  name: string;
}

interface MessageData {
  content: string;
  sender: string;
  id: string;
  timestamp: number;
}

describe("WebSocket Server", () => {
  // Use static server instance
  let staticServer: ReturnType<typeof Server.listen>;
  let clientSocket: Socket;
  const port = 3334;
  const SOCKET_TIMEOUT = 1000;

  const mockUser: MockUser = {
    uuid: "user123",
    name: "Test User",
    email: "test@example.com",
  };
  const mockRoomId = "room123";

  beforeAll(async () => {
    // Start server
    if (Server.listening) {
      Server.close();
    }

    // Create single server instance
    await new Promise<void>((resolve, reject) => {
      try {
        staticServer = Server.listen(port, () => resolve());
      } catch (err) {
        reject(err);
      }
    });

    // Setup client socket
    clientSocket = Client(`http://localhost:${port}`, {
      autoConnect: true,
      reconnection: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Connection timeout")),
        SOCKET_TIMEOUT,
      );

      clientSocket.on("connect", () => {
        clearTimeout(timeout);
        resolve();
      });

      clientSocket.on("connect_error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  });

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(true),
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    clientSocket.removeAllListeners();
  });

  afterAll(async () => {
    if (clientSocket) {
      clientSocket.close();
    }

    // Close server only if it exists
    if (staticServer) {
      await new Promise<void>((resolve) => {
        staticServer.close(() => resolve());
      });
    }
  });

  // Rest of the test cases remain the same
  it("should connect successfully", () => {
    expect(clientSocket.connected).toBe(true);
  });

  it("should handle user_connected event", async () => {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Room update timeout")),
        SOCKET_TIMEOUT,
      );

      clientSocket.on("room_update", (roomData: RoomData) => {
        try {
          expect(roomData).toBeDefined();
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      clientSocket.emit("user_connected", mockUser, mockRoomId);
    });
  });

  it("should handle update_streamer event", async () => {
    const mockStreamerId = "streamer123";

    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ uuid: mockRoomId, name: "Test Room" }),
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Streamer update timeout")),
        SOCKET_TIMEOUT,
      );

      clientSocket.on("room_update", (roomData: RoomData) => {
        try {
          expect(roomData.uuid).toBe(mockRoomId);
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      clientSocket.emit("update_streamer", mockStreamerId, mockRoomId);
    });
  });

  it("should handle disconnecting event", async () => {
    clientSocket.emit("user_connected", mockUser, mockRoomId);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Disconnect timeout")),
        SOCKET_TIMEOUT,
      );

      clientSocket.on("disconnect", () => {
        try {
          expect(clientSocket.connected).toBe(false);
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      clientSocket.disconnect();
    });
  });
});
