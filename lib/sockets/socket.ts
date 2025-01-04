import { io } from "socket.io-client";

// "undefined" means the URL will be computed from the `window.location` object
const URL =
  process.env.NODE_ENV === "production"
    ? process.env.WEBSOCKETSERVER_URL
    : "http://localhost:8800";
console.log(`Connecting to websocket server at: ${URL}`);
export const socket = io(URL, { autoConnect: true, reconnection: true });
