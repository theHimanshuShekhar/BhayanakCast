import { io } from "socket.io-client";

const getSocketURL = async () => {
  try {
    // Check if window is defined (client-side)
    if (typeof window !== "undefined") {
      const response = await fetch("/api/util/getSocketServerURL");
      const data = await response.json();
      console.log(`getSocketURL: ${data.url}`);
      return data.url;
    }
    // Server-side fallback
    return process.env.WEBSOCKETSERVER_URL || "http://localhost:3333";
  } catch (error) {
    console.error("Failed to get socket URL:", error);
    return "http://localhost:3333"; // Fallback URL
  }
};

const URL = await getSocketURL();

console.log(`URL: ${URL}`);

export const socket = io(URL, {
  autoConnect: false,
  reconnection: true,
});
