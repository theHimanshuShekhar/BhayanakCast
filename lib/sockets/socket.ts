import { io } from "socket.io-client";

export const getSocketURL = () => {
  // Check if window is defined (client-side)
  if (typeof window !== "undefined") {
    return fetch("/api/util/getSocketServerURL")
      .then((response) => response.json())
      .then((data) => {
        if (data?.url) {
          return data.url;
        }
        console.error("URL from API is malformed or missing.");
        return "http://localhost:3333";
      })
      .catch((error) => {
        console.error("Failed to get socket URL:", error);
        return "http://localhost:3333";
      });
  }
  // Server-side fallback
  return process.env.WEBSOCKETSERVER_URL || "http://localhost:3333";
};

export const getSocket = async () => {
  const URL = await getSocketURL();

  const websocket_server_url = URL;

  console.log(`connecting to Websocket server: ${websocket_server_url}`);

  return io(websocket_server_url, {
    autoConnect: false,
    reconnection: true,
  });
};
