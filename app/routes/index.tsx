import { createFileRoute } from "@tanstack/react-router";
import Navbar from "../../lib/components/ui/navbar";
import { RoomCard } from "~/lib/components/ui/room-card";

export const Route = createFileRoute("/")({
  component: Home,
});

const roomList = [
  { name: "testBhayanak" },
  { name: "testGoti" },
  { name: "testRoom" },
  { name: "testRoom" },
  { name: "testRoom" },
  { name: "testRoom" },
];

function Home() {
  const { user } = Route.useRouteContext();
  return (
    <>
      <Navbar user={user} />
      <div className="py-4">
        <div className="pb-4 text-2xl font-semibold">Room List</div>
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {roomList.map((room) => (
            <div key={room.name}>
              <a href={`/room/${room.name}`}>
                <RoomCard roomName={room.name} />
              </a>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
