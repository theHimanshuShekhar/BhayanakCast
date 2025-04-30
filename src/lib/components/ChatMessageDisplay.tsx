import TimeAgo from "javascript-time-ago";
import en from "javascript-time-ago/locale/en";
import type { ChatMessage } from "../types";

TimeAgo.addDefaultLocale(en);

// Create formatter (English).
const timeAgo = new TimeAgo("en-US");

export default function ChatMessageDisplay({ message }: { message: ChatMessage }) {
  console.log("MessageContent", message);
  return (
    <div className="flex items-center gap-1 p-1">
      {message.user?.image && (
        <img
          src={message.user?.image || "/default-avatar.png"}
          alt={message.user?.name || "User"}
          className="w-8 h-8 rounded-full"
          loading="lazy"
        />
      )}
      <div className="flex flex-col">
        {message.user && (
          <>
            <div className="flex items-center gap-2">
              <span className="font-bold">{message.user?.name || "Unknown User"}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {timeAgo.format(new Date(message.timestamp))}
              </span>
            </div>

            <div className="text-sm text-gray-700 dark:text-gray-300">
              {message.content}
            </div>
          </>
        )}
        {!message.user && (
          <div className="text-sm text-gray-700 dark:text-gray-300 font-semibold">
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}
