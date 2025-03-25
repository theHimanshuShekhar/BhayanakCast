import { defineEventHandler, defineWebSocket } from "@tanstack/react-start/server";
import type { Peer } from "crossws";
import { v4 as uuidv4 } from "uuid";
import { MessageType, type User } from "./lib/types";
const peers: Map<Peer, { userId: string; roomID: string }> = new Map();

let serverURL: string | null = null;

export default defineEventHandler({
  async handler() {},
  websocket: defineWebSocket({
    upgrade(request) {
      const host =
        request?.headers.get("x-forwarded-host") || request?.headers.get("host");
      if (!host) {
        return new Response("No host", { status: 400 });
      }

      const isSecure = request?.headers.get("x-forwarded-proto") === "https";
      const protocol = isSecure ? "https" : "http";
      serverURL = `${protocol}://${host}`;
      return new Response(null, { status: 200, headers: { "X-Host": host } });
    },
    open(peer) {
      console.log(`User ${peer.id} has connected!`);
    },
    async message(peer, msg) {
      const message = JSON.parse(msg.text());
      switch (message.type) {
        case MessageType.JOIN: {
          joinRoom(peer, message.roomID, message.user);
          break;
        }
        // case MessageType.LEAVE: {
        //   leaveRoom(peer, message.roomID, message.user);
        //   break;
        // }
        case MessageType.CHATMESSAGE: {
          chatMessage(peer, message.roomID, message.user, message.content);
          break;
        }
        default:
          console.log("Unknown MessageType", message.type);
      }
    },
    async close(peer) {
      console.log("close", peer.id);
      const peerData = peers.get(peer);
      if (peerData) {
        leaveRoom(peer, peerData.userId);
        peers.delete(peer);
      }
    },
    async error(peer, error) {
      console.log("error", peer.id, error);
    },
  }),
});

const joinRoom = async (peer: Peer, roomID: string, user: User) => {
  console.log("join", roomID, user.name);

  const response = await fetch(`${serverURL}/api/room/join/${roomID}/${user.id}`);
  const data = await response.json();

  if (data.status !== "success") {
    console.log("Failed to add viewer to room", data);
    return;
  }

  peers.set(peer, { userId: user.id, roomID });
  peer.subscribe(roomID);
  peer.publish(
    roomID,
    JSON.stringify({
      type: MessageType.CHATMESSAGE,
      id: uuidv4(),
      content: `${user.name} joined the room`,
      timestamp: new Date(),
    }),
  );
};

const leaveRoom = async (peer: Peer, userId: string) => {
  console.log("leave", userId);

  const response = await fetch(`${serverURL}/api/room/leave/${userId}`);
  const data = await response.json();

  console.log("leaveRoom", data);

  if (data.status !== "success") {
    console.log("Failed to add viewer to room", data);
    return;
  }

  if (data.leavingRoomID) {
    peer.unsubscribe(data.leavingRoomID);
    peer.publish(
      data.leavingRoomID,
      JSON.stringify({
        type: MessageType.CHATMESSAGE,
        id: uuidv4(),
        content: `${data.leavingRoomName} left the room`,
        timestamp: new Date(),
      }),
    );
    peer.close();
  }
};

const chatMessage = (peer: Peer, roomID: string, user: User, content: string) => {
  console.log("message", roomID, user, content);
};
