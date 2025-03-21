import UserDisplay from "./UserDisplay";

interface RoomCardProps {
  room: {
    id: string;
    name: string;
    description: string | null;
    image: string | null;
    streamer: {
      id: string;
      name: string;
      image: string | null;
    } | null;
    createdAt: Date;
    updatedAt: Date | null;
  };
}

export function RoomCard({ room }: RoomCardProps) {
  const { name, description, image, streamer } = room;

  return (
    <div className="w-full group/card">
      <div
        className="cursor-pointer border overflow-hidden relative card h-96 rounded-md shadow-xl backgroundImage flex flex-col justify-between p-4 dark:bg-gray-900 bg-cover"
        style={{ backgroundImage: image ? `url(${image})` : "none" }}
      >
        <div className="absolute w-full h-full top-0 left-0 transition duration-300 group-hover/card:bg-gray-300 dark:group-hover/card:bg-black opacity-60" />
        {streamer && (
          <div className="flex flex-row items-center space-x-4 z-10">
            <div className="flex justify-center align-middle gap-2 items-center">
              <UserDisplay id={streamer.id} name={streamer.name} image={streamer.image} />
              <p className="text-sm text-gray-400">{room.createdAt.toDateString()}</p>
            </div>
          </div>
        )}
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
