import TimeAgo from "javascript-time-ago";
import en from "javascript-time-ago/locale/en";
import type { RoomWithViewers } from "../types";
import UserDisplay from "./UserDisplay";

TimeAgo.addDefaultLocale(en);

// Create formatter (English).
const timeAgo = new TimeAgo("en-US");

interface RoomCardProps {
  room: RoomWithViewers;
}

export function RoomCard({ room }: RoomCardProps) {
  const { name, description, image, streamer } = room;

  return (
    <div className="w-full group/card">
      <div
        className="cursor-pointer bg-white border overflow-hidden relative card h-96 rounded-md shadow-xl flex flex-col justify-between p-4 dark:bg-gray-800 bg-cover"
        style={{ backgroundImage: image ? `url(${image})` : "none" }}
      >
        <div className="absolute w-full h-full top-0 left-0 transition duration-300 group-hover/card:bg-gray-200 dark:group-hover/card:bg-gray-700 opacity-60" />
        {streamer && (
          <div className="flex flex-row items-center space-x-4 z-10">
            <div className="flex justify-start align-middle gap-2 items-center w-full ">
              <UserDisplay id={streamer.id} name={streamer.name} image={streamer.image} />
              <p className="text-sm text-gray-400">{timeAgo.format(room.createdAt)}</p>
            </div>
          </div>
        )}
        <div className="text content">
          <div className="text-wrap break-words font-bold text-xl md:text-2xl lg:text-4xl dark:text-gray-50 relative z-10">
            {name}
          </div>
          <div className="font-normal text-sm dark:text-gray-50 relative z-10 my-2">
            {description}
          </div>
        </div>
      </div>
    </div>
  );
}
