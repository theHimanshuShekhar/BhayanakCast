import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ConnectionState } from "~/lib/components/ui/connection-state";
import { createRoom, getRoom } from "~/lib/functions";

import { socket } from "~/lib/sockets/socket";

export const Route = createFileRoute("/room/$roomid/$roomname")({
  component: RoomPageComponent,
  beforeLoad: async ({ context, params }) => {
    // If user is not logged in, redirect to home page
    if (!context.user) {
      throw redirect({
        to: "/",
      });
    }

    await createRoom({ data: params });
  },
  loader: async ({ context, params }) => {
    return {
      user: context.user,
      initialRoomData: await getRoom({
        data: { roomid: params.roomid },
      }),
    };
  },
});

function RoomPageComponent() {
  const { user, initialRoomData } = Route.useLoaderData();
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [roomData, setRoomData] = useState(initialRoomData);

  useEffect(() => {
    if (!user) return;
    if (!socket.connected) socket.connect();

    function onConnect() {
      setIsConnected(true);
      if (!user) return;
      socket.emit("user_connected", user, roomData.uuid);
      socket.emit("join_room", user.uuid, roomData.uuid);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on("room_update", (roomDetails) => {
      setRoomData(roomDetails);
    });

    return () => {
      socket.off("room_update");
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [roomData, user]);

  return (
    <>
      <ConnectionState isConnected={isConnected} />
      <div className="font-bold">
        <pre>{JSON.stringify(roomData, null, 2)}</pre>
      </div>
    </>
  );
}
