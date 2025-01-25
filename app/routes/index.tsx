import { createFileRoute } from "@tanstack/react-router";
import { Input } from "~/lib/components/ui/input";
import { Label } from "~/lib/components/ui/label";
import { Button } from "~/lib/components/ui/button";
import { useState } from "react";
import { Plus } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import { fetchRooms } from "~/lib/server/db/actions";
import { RoomCard } from "~/lib/components/ui/room-card";
import { createServerFn } from "@tanstack/start";
import Navbar from "~/lib/components/ui/navbar";

export const Route = createFileRoute("/")({
  component: Home,
  loader: async () => {
    return getRooms();
  },
});

const getRooms = createServerFn({ method: "GET" }).handler(async () => {
  return await fetchRooms();
});

function Home() {
  const { user } = Route.useRouteContext();
  const [inputRoomName, setInputRoomName] = useState("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const roomList = Route.useLoaderData();

  const handleClick = () => {
    setIsLoading(true);
    // Simulate an async operation
    setTimeout(() => {
      setIsLoading(false);
    }, 1000); // Reset after 1 second
  };

  return (
    <>
      <div className="p-2 md:p-4">
        <Navbar user={user} />
        <div className="py-2">
          <Label htmlFor="roomNameInput">Create or Search Room</Label>
          {inputRoomName}
          <div className="flex justify-between gap-2 pb-4 align-middle">
            <Input
              id="roomNameInput"
              className="bg-muted border-transparent shadow-none"
              placeholder="Room Name"
              type="text"
              onChange={(e) => {
                e.preventDefault();
                setInputRoomName(e.target.value);
              }}
            />
            <Button
              onClick={handleClick}
              disabled={isLoading}
              data-loading={isLoading}
              className="group relative bg-purple-800 text-gray-100 disabled:opacity-100"
            >
              <Plus
                className="opacity-60 group-data-[loading=true]:text-transparent"
                size={16}
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="group-data-[loading=true]:text-transparent">
                Create Room
              </span>
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <LoaderCircle
                    className="animate-spin"
                    size={16}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </div>
              )}
            </Button>
          </div>
        </div>
        <div className="pb-4 text-2xl font-semibold">
          Active - {roomList.length} Rooms
        </div>
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {roomList.map((room) => (
            <div key={room.room.name}>
              <a href={`/room/${room.room.uuid}/${room.room.name}`}>
                <RoomCard room={room.room} />
              </a>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
