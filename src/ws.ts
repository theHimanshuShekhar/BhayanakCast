import { defineEventHandler, defineWebSocket } from "@tanstack/react-start/server";
import { MessageType, type Room, type User } from "./lib/types";

const rooms = new Map<Room["id"], Room>();
const users = new Map<string, User>();

export default defineEventHandler({
  handler() {},
  websocket: defineWebSocket({
    open(peer) {
      console.log(`User ${peer.id} has connected!`);
    },
    async message(peer, msg) {
      const message = JSON.parse(msg.text());
      console.log("msg", peer.id, message);
      switch (message.type) {
        case MessageType.JOIN: {
          joinRoom(message.roomID, message.userID);
          break;
        }
        case MessageType.LEAVE: {
          leaveRoom(message.roomID, message.userID);
          break;
        }
        case MessageType.CHATMESSAGE: {
          chatMessage(message.roomID, message.userID, message.content);
          break;
        }
        default:
          console.log("Unknown MessageType", message.type);
      }
    },
    async close(peer, details) {
      console.log("close", peer.id, details.reason);
    },
    async error(peer, error) {
      console.log("error", peer.id, error);
    },
  }),
});

const joinRoom = (roomID: string, userID: string) => {
  console.log("join", roomID, userID);
};

const leaveRoom = (roomID: string, userID: string) => {
  console.log("leave", roomID, userID);
};

const chatMessage = (roomID: string, userID: string, content: string) => {
  console.log("message", roomID, userID, content);
};
