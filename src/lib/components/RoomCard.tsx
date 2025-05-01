import TimeAgo from "javascript-time-ago";
import en from "javascript-time-ago/locale/en";
import { useMemo } from "react";
import type { RoomWithViewers } from "../types";
import UserDisplay from "./UserDisplay";

interface RoomCardProps {
  room: RoomWithViewers;
}

export function RoomCard({ room }: RoomCardProps) {
  const { name, description, image, streamer } = room;

  // SSR-safe: only add locale and create instance on client
  const timeAgo = useMemo(() => {
    if (typeof window !== "undefined") {
      TimeAgo.addDefaultLocale(en);
      return new TimeAgo("en-US");
    }
    return null;
  }, []);

  return (
    <div className="w-full group/card">
      <div
        className="cursor-pointer bg-white box-content overflow-hidden relative card h-96 rounded-md shadow-xl flex flex-col justify-between p-4 dark:bg-gray-800 bg-cover bg-center"
        style={{ backgroundImage: image ? `url(${image})` : "none" }}
      >
        <div className="absolute w-full h-full top-0 left-0 transition duration-300 z-0 group-hover/card:bg-gray-200/70 dark:group-hover/card:bg-gray-700/70 bg-white/5 backdrop-blur-xs" />
        {streamer && (
          <div
            className={`flex flex-row items-center space-x-4 z-10 ${image ? "bg-white/10 dark:bg-gray-700/10 rounded-md p-1" : ""}`}
          >
            <div className="flex align-middle gap-2 items-center w-full">
              <UserDisplay id={streamer.id} name={streamer.name} image={streamer.image} />
              <p className="text-sm">{timeAgo ? timeAgo.format(room.createdAt) : ""}</p>
            </div>
          </div>
        )}
        <div
          className={`flex flex-col justify-center w-full z-10 ${image ? "bg-white/10 dark:bg-gray-700/10 rounded-md p-1" : ""}`}
        >
          <div className="text-wrap break-words font-bold text-xl md:text-2xl lg:text-4xl dark:text-gray-50 relative z-10">
            {name}
          </div>
          {description && description.length > 0 && (
            <div className="font-normal text-sm dark:text-gray-50 relative z-10 my-2">
              {description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
