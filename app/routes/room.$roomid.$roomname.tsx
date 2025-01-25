import { createFileRoute, redirect } from "@tanstack/react-router";
import { type ChangeEvent, useEffect, useState } from "react";

import { createRoom, getRoom } from "~/lib/functions";
import type { User } from "~/lib/server/db/schema";

import { getSocket } from "~/lib/sockets/socket";

import BlurFade from "~/lib/components/ui/blur-fade";
import { UserList } from "~/lib/components/ui/user-list";
import ChatBox from "~/lib/components/ui/chat-box";
import Navbar from "~/lib/components/ui/navbar";
import { io, type Socket } from "socket.io-client";

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

interface Message {
  content: string;
  sender: User;
  id: string;
  timestamp: Date;
}

function RoomPageComponent() {
  const { user, initialRoomData } = Route.useLoaderData();
  const [socket, setSocket] = useState<Socket>(() => io());
  const [isConnected, setIsConnected] = useState(false);
  const [roomData, setRoomData] = useState(initialRoomData);
  const [inputText, setInputText] = useState("");
  const [messageList, setMessageList] = useState<Message[]>([]);

  useEffect(() => {
    const initSocket = async () => {
      const newSocket = await getSocket();
      setSocket(newSocket);
    };
    initSocket();
  }, []);

  useEffect(() => {
    if (socket && !socket.active && !socket.connected) socket.connect();
  }, [socket]);

  useEffect(() => {
    if (!user) return;
    if (socket && socket === undefined) return;

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

    socket.on("message_update", (message) => {
      setMessageList((prev) => [...prev, message]);
    });

    return () => {
      socket.off("room_update");
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message_update");
    };
  }, [socket, user, roomData]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    setInputText(e.target.value);
  };

  const sendMessage = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    socket.emit("send_message", inputText, roomData.uuid);
    setInputText("");
  };

  return (
    <div className="grid-row-auto flex max-h-screen min-h-screen flex-col justify-start gap-2 lg:grid lg:flex-none lg:grid-cols-7 xl:grid-cols-8">
      <BlurFade
        delay={0.25}
        inView
        className="col-span-full flex max-h-fit flex-col gap-4 p-2 lg:col-span-4 xl:col-span-6"
      >
        <Navbar user={user} />
        <video
          className="min-w-full rounded-lg"
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
        <div className="col-span-full flex flex-wrap gap-1">
          <UserList
            userList={roomData.users.filter((user): user is User => user !== null)}
          />
        </div>
      </BlurFade>
      <BlurFade
        delay={0.3}
        inView
        className="col-span-full h-full max-h-screen rounded-lg bg-gray-800 p-2 lg:col-span-3 xl:col-span-2"
      >
        <ChatBox
          roomData={roomData}
          isConnected={isConnected}
          messageList={messageList.filter((message) => message.content.length > 0)}
          handleChange={handleChange}
          inputText={inputText}
          sendMessage={sendMessage}
        />
      </BlurFade>
    </div>
  );
}
