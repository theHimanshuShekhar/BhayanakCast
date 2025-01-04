import { createFileRoute, redirect } from "@tanstack/react-router";
import { type ChangeEvent, useEffect, useState } from "react";
import { ConnectionState } from "~/lib/components/ui/connection-state";
import { createRoom, getRoom } from "~/lib/functions";
import BlurFade from "~/lib/components/ui/blur-fade";
import type { User } from "~/lib/server/db/schema";
import { socket } from "~/lib/sockets/socket";
import { UserList } from "~/lib/components/ui/user-list";
import { formatDistanceToNow } from "date-fns";

import { ChatInput } from "~/lib/components/ui/chat-input";
import { Avatar, AvatarImage } from "~/lib/components/ui/avatar";

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
  const [isConnected, setIsConnected] = useState(false);
  const [roomData, setRoomData] = useState(initialRoomData);
  const [inputText, setInputText] = useState("");
  const [messageList, setMessageList] = useState<Message[]>([]);

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

    socket.on("message_update", (message) => {
      setMessageList((prev) => [...prev, message]);
    });

    return () => {
      socket.off("room_update");
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message_update");
    };
  }, [user, roomData]);

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
    <div className="max-w-screen mt-4 flex flex-col">
      <div className="order-1 grid grid-cols-6 gap-2">
        <BlurFade delay={0.25} inView className="col-span-full lg:col-span-4">
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
          delay={0.3}
          inView
          className="order-3 col-span-full rounded-lg bg-gray-800 p-2 lg:order-2 lg:col-span-2"
        >
          <div className="flex h-full flex-col gap-2 text-wrap">
            <div className="w-full">
              <div className="text-pretty break-words text-2xl font-bold">
                {roomData.name}
              </div>
              <ConnectionState isConnected={isConnected} />
            </div>
            <div className="min-h-[300px] w-full grow rounded-lg bg-gray-700 p-2 text-xs">
              {messageList?.map((message) => (
                <BlurFade
                  key={message.id}
                  delay={0.15}
                  inView
                  className="col-span-full lg:col-span-4"
                >
                  <div className="my-2 flex grow flex-col items-start">
                    <div className="inline-flex gap-1">
                      <Avatar className="inline-flex h-7 w-7">
                        <AvatarImage
                          src={
                            message.sender.avatar_url ?? "https://github.com/shadcn.png"
                          }
                        />
                      </Avatar>
                      <div className="inline-flex items-center space-x-1">
                        <span className="flex-wrap text-sm font-semibold text-gray-900 dark:text-white">
                          {message.sender.name}
                        </span>
                        <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                          {formatDistanceToNow(new Date(message.timestamp), {
                            includeSeconds: true,
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </div>
                    <p className="w-full flex-none flex-wrap text-pretty break-words text-sm font-normal text-gray-900 dark:text-white">
                      {message.content}
                    </p>
                  </div>
                </BlurFade>
              ))}
            </div>

            <ChatInput
              handleChange={handleChange}
              inputText={inputText}
              sendMessage={sendMessage}
            />
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
