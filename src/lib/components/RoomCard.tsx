"use client";
import { cn } from "~/lib/utils";

interface RoomCardProps {
  room: {
    id: string;
    name: string;
    description: string | null;
    image: string | null;
    streamer: string;
    createdAt: Date;
    updatedAt: Date | null;
  };
}

export function RoomCard({ room }: RoomCardProps) {
  const { name, description, image, streamer } = room;

  const fallbackImage =
    "https://i.ytimg.com/vi/ozr55Cnj9iA/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARUAAAAAGAElAADIQj0AgKJD&rs=AOn4CLBOZK7R6CwhcpGtO5qVxbVcYy6YFQ";

  return (
    <div className="w-full group/card">
      <div
        className={cn(
          "cursor-pointer border overflow-hidden relative card h-96 rounded-md shadow-xl backgroundImage flex flex-col justify-between p-4",
          `bg-[url(${fallbackImage})] dark:bg-gray-800 bg-cover`,
        )}
      >
        <div className="absolute w-full h-full top-0 left-0 transition duration-300 group-hover/card:bg-gray-300 dark:group-hover/card:bg-black opacity-60" />
        <div className="flex flex-row items-center space-x-4 z-10">
          <img
            className="h-10 w-10 rounded-full border-2 object-cover"
            src={image || fallbackImage}
            alt="Crime Master Gogo restaurant article"
          />
          <div className="flex flex-col text-wrap">
            <p className="font-normal text-base dark:text-gray-50 relative z-10">
              {streamer.slice(0, 12)}
            </p>
            <p className="text-sm text-gray-400">{room.createdAt.toLocaleString()}</p>
          </div>
        </div>
        <div className="text content">
          <h1 className="font-bold text-xl md:text-2xl lg:text-4xl dark:text-gray-50 relative z-10">
            {name}
          </h1>
          <p className="font-normal text-sm dark:text-gray-50 relative z-10 my-4">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
