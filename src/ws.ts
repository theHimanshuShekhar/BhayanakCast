import { defineEventHandler, defineWebSocket } from "@tanstack/react-start/server";

export default defineEventHandler({
  handler() {},
  websocket: defineWebSocket({
    open(peer) {
      console.log(`User ${peer.id} has connected!`);
    },
    async message(peer, msg) {
      const message = msg.text();
      console.log("msg", peer.id, message);
    },
    async close(peer, details) {
      console.log("close", peer.id, details.reason);
    },
    async error(peer, error) {
      console.log("error", peer.id, error);
    },
  }),
});
