import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

    // const Room =
    await createRoom({ data: params });
    // addUserToRoom({ data: { userUUID: context.user.uuid, roomUUID: Room.uuid } });
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

  console.log("initialRoomData", initialRoomData);

  useEffect(() => {
    if (!user) return;
    if (!socket.connected) socket.connect();

    function onConnect() {
      setIsConnected(true);
      socket.emit("user_connected", user);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on("room_update", (roomDetails) => {
      console.log("room_update", roomDetails);
      setRoomData(roomDetails);
    });

    return () => {
      socket.emit("user_disconnected", user);
      socket.off("room_update");
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  });

  useEffect(() => {
    if (!user) return;
    // socket.emit("user_connected", user, (response: { response: { data: string } }) => {
    //   console.log("user_connected ack", response);
    // });
    socket.emit("join_room", user.uuid, roomData.uuid);

    return () => {
      socket.emit("leave_room", socket.id, roomData.uuid);
    };
  }, [roomData.uuid, user]);

  return (
    <>
      <ConnectionState isConnected={isConnected} />
      <div className="font-bold">
        <pre>{JSON.stringify(roomData, null, 2)}</pre>
      </div>
    </>
  );
}

function ConnectionState({ isConnected }: { isConnected: boolean }) {
  return <p>State: {`${isConnected}`}</p>;
}
