import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSocket, getSocketURL } from "./socket";
import { io } from "socket.io-client";

// mock the socket.io-client module using vitest
vi.mock("socket.io-client", () => {
  const mockSocket = {
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return {
    io: vi.fn(() => mockSocket),
  };
});

describe("socket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBSOCKETSERVER_URL = undefined;
    vi.stubGlobal("window", {});
    global.fetch = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("getSocketURL", () => {
    it("should return URL from API on client side", async () => {
      const mockURL = "http://test-server:3333";
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ url: mockURL }),
      });

      const url = await getSocketURL();
      expect(url).toBe(mockURL);
      expect(global.fetch).toHaveBeenCalledWith("/api/util/getSocketServerURL");
    });

    it("should return environment URL on server side", async () => {
      const envURL = "http://env-server:4444";
      process.env.WEBSOCKETSERVER_URL = envURL;
      vi.stubGlobal("window", undefined);

      const url = await getSocketURL();
      expect(url).toBe(envURL);
    });

    it("should handle API returning malformed URL", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({}), // Missing 'url' field
      });

      const url = await getSocketURL();
      expect(url).toBe("http://localhost:3333"); // Or your default URL
      expect(console.error).toHaveBeenCalledWith("URL from API is malformed or missing.");
    });

    it("should handle network errors", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const url = await getSocketURL();
      expect(url).toBe("http://localhost:3333"); // Or your default URL
      expect(console.error).toHaveBeenCalledWith(
        "Failed to get socket URL:",
        expect.any(Error),
      );
    });
  });

  describe("getSocket", () => {
    it("should connect to socket server with URL from API on client side", async () => {
      const mockURL = "http://test-server:3333";
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ url: mockURL }),
      });

      const socket = await getSocket();

      expect(global.fetch).toHaveBeenCalledWith("/api/util/getSocketServerURL");
      expect(io).toHaveBeenCalledWith(mockURL, {
        autoConnect: false,
        reconnection: true,
      });
      expect(socket).toBeDefined();
    });

    it("should use environment variable URL on server side", async () => {
      const envURL = "http://env-server:4444";
      process.env.WEBSOCKETSERVER_URL = envURL;
      vi.stubGlobal("window", undefined);

      const socket = await getSocket();

      expect(io).toHaveBeenCalledWith(envURL, {
        autoConnect: false,
        reconnection: true,
      });
      expect(socket).toBeDefined();
    });

    it("should use fallback URL when fetch fails", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Fetch failed"));

      const socket = await getSocket();

      expect(console.error).toHaveBeenCalledWith(
        "Failed to get socket URL:",
        expect.any(Error),
      );
      expect(io).toHaveBeenCalledWith("http://localhost:3333", {
        autoConnect: false,
        reconnection: true,
      });
      expect(socket).toBeDefined();
    });

    it("should use fallback URL when no URL is available", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ url: null }),
      });

      const socket = await getSocket();

      console.log(socket);

      expect(io).toHaveBeenCalledWith("http://localhost:3333", {
        autoConnect: false,
        reconnection: true,
      });
      expect(socket).toBeDefined();
    });

    it("should log connection message", async () => {
      const mockURL = "http://test-server:3333";
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ url: mockURL }),
      });

      await getSocket();

      expect(console.log).toHaveBeenCalledWith(
        `connecting to Websocket server: ${mockURL}`,
      );
    });

    it("should pass connection options to io", async () => {
      const mockURL = "http://test-server:3333";
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ url: mockURL }),
      });

      await getSocket();

      expect(io).toHaveBeenCalledWith(
        mockURL,
        expect.objectContaining({
          autoConnect: false,
          reconnection: true,
        }),
      );
    });
  });
});
