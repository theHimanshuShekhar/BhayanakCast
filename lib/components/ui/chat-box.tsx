import { Avatar, AvatarImage } from "./avatar";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { User } from "~/lib/server/db/schema";

import BlurFade from "./blur-fade";
import { ChatInput } from "./chat-input";
import { ConnectionState } from "./connection-state";

interface Message {
  content: string;
  sender: User;
  id: string;
  timestamp: Date;
}

interface ChatBoxProps {
  roomData: {
    id: number;
    name: string | null;
    uuid: string;
    banner_url: string | null;
    created_at: Date;
    updated_at: Date | null;
    users: (User | null)[];
  };
  isConnected: boolean;
  messageList: Message[];
  handleChange: (e: ChangeEvent<HTMLInputElement>) => void;
  inputText: string;
  sendMessage: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export default function ChatBox({
  roomData,
  isConnected,
  messageList,
  handleChange,
  inputText,
  sendMessage,
}: ChatBoxProps) {
  const chatBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollToBottom = () => {
      if (chatBoxRef.current) {
        chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
      }
    };

    // Use MutationObserver to detect DOM changes
    const observer = new MutationObserver(scrollToBottom);
    if (chatBoxRef.current) {
      observer.observe(chatBoxRef.current, { childList: true, subtree: true });
    }

    // Initial scroll
    scrollToBottom();

    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex min-h-[300px] flex-col gap-2 text-wrap lg:max-h-screen lg:min-h-full">
      <RoomDetails isConnected={isConnected} roomData={roomData} />
      <div
        id="chatbox"
        ref={chatBoxRef}
        className="max-h-screen min-h-[300px] w-full flex-1 grow overflow-y-scroll rounded-lg bg-gray-700 p-2 text-xs"
      >
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
                    src={message.sender.avatar_url ?? "https://github.com/shadcn.png"}
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
  );
}

function RoomDetails({
  isConnected,
  roomData,
}: {
  isConnected: boolean;
  roomData: ChatBoxProps["roomData"];
}) {
  return (
    <div className="w-full">
      <div className="text-pretty break-words text-2xl font-bold">{roomData.name}</div>
      <ConnectionState isConnected={isConnected} />
    </div>
  );
}
