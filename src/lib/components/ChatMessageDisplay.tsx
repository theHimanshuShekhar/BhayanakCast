import TimeAgo from "javascript-time-ago";
import en from "javascript-time-ago/locale/en";
import ReactTimeAgo from "react-time-ago";
import type { ChatMessage } from "../types";

TimeAgo.addDefaultLocale(en);

export default function ChatMessageDisplay({ message }: { message: ChatMessage }) {
  return (
    <div className="mb-1 flex flex-col min-w-0 w-full overflow-x-hidden">
      {message.user && (
        <div className="flex items-center gap-2 p-1 w-full max-w-full min-w-0">
          {message.user?.image && (
            <img
              src={message.user?.image || "/default-avatar.png"}
              alt={message.user?.name || "User"}
              className="w-8 h-8 rounded-full"
              loading="lazy"
            />
          )}
          <div className="flex items-center gap-2 min-w-0 w-full">
            <span className="font-bold truncate">
              {message.user?.name || "Unknown User"}
            </span>
            <ReactTimeAgo
              date={new Date(message.timestamp)}
              timeStyle="twitter"
              component="span"
              className="text-gray-500 dark:text-gray-400"
            />
          </div>
        </div>
      )}
      <div className="text-sm text-gray-700 dark:text-gray-300 font-semibold break-words whitespace-pre-line overflow-hidden w-full min-w-0">
        {message.content}
      </div>
    </div>
  );
}
