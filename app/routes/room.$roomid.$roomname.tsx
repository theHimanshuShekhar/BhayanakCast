import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ConnectionState } from "~/lib/components/ui/connection-state";
import { createRoom, getRoom } from "~/lib/functions";
import BlurFade from "~/lib/components/ui/blur-fade";
import type { User } from "~/lib/server/db/schema";
import { socket } from "~/lib/sockets/socket";
import { UserList } from "~/lib/components/ui/user-list";

import { ChatInput } from "~/lib/components/ui/chat-input";

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
  const [isConnected, setIsConnected] = useState(false);
  const [roomData, setRoomData] = useState(initialRoomData);

  useEffect(() => {
    if (!user) return;
    // if (!socket.connected) socket.connect();

    function onConnect() {
      setIsConnected(socket.connected);
      if (!user) return;
      socket.emit("user_connected", user, roomData.uuid);
    }

    function onDisconnect() {
      setIsConnected(socket.connected);
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
  }, [user, roomData]);

  return (
    <div className="max-w-screen mt-4 flex flex-col">
      <div className="order-1 grid grid-cols-5 gap-2">
        <BlurFade
          key={"socket.id"}
          delay={0.25}
          inView
          className="col-span-full lg:col-span-4"
        >
          <video
            className="rounded-lg"
            autoPlay
            muted
            loop
            controls
            src="https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4"
          >
            <track
              kind="captions"
              src="/path/to/captions.vtt"
              srcLang="en"
              label="English"
            />
            <track
              kind="descriptions"
              src="/path/to/descriptions.vtt"
              srcLang="en"
              label="English"
            />
          </video>
        </BlurFade>
        <BlurFade
          key={socket.id}
          delay={0.3}
          inView
          className="order-3 col-span-full rounded-lg bg-gray-800 p-2 lg:order-2 lg:col-span-1"
        >
          <div className="flex h-full flex-col gap-2 text-wrap">
            <div className="flex-none">
              <div className="text-wrap text-2xl font-bold">{roomData.name}</div>
              <ConnectionState isConnected={isConnected} />
            </div>
            <div className="min-h-[300px] grow rounded-lg bg-gray-700 p-2">Test</div>
            <ChatInput />
          </div>
        </BlurFade>
        <div className="order-2 col-span-full flex flex-wrap gap-1 lg:order-3">
          <UserList
            userList={roomData.users.filter((user): user is User => user !== null)}
          />
        </div>
      </div>
    </div>
  );
}
