import { io } from "socket.io-client";

const getSocketURL = () => {
  try {
    // Check if window is defined (client-side)
    if (typeof window !== "undefined") {
      return fetch("/api/util/getSocketServerURL")
        .then((response) => response.json())
        .then((data) => data.url);
    }
    // Server-side fallback
    return process.env.WEBSOCKETSERVER_URL || "http://localhost:3333";
  } catch (error) {
    console.error("Failed to get socket URL:", error);
    return "http://localhost:3333"; // Fallback URL
  }
};

export const getSocket = async () => {
  const URL = await getSocketURL();

  const websocket_server_url = URL || "http://localhost:3333";

  console.log(`connecting to Websocket server: ${websocket_server_url}`);

  return io(websocket_server_url, {
    autoConnect: false,
    reconnection: true,
  });
};
