import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { RoomCard } from "~/lib/components/RoomCard";
import { SearchBar } from "~/lib/components/Search";
import { getRoomsFromDB, removeUserFromRoomDB } from "~/lib/server/functions";

const cacheTime = 1000 * 15;

const roomsQueryOptions = queryOptions({
  queryKey: [],
  queryFn: () => getRoomsFromDB(),
  staleTime: cacheTime,
  gcTime: cacheTime,
  refetchInterval: cacheTime,
  refetchOnWindowFocus: true,
});

export const Route = createFileRoute("/")({
  component: Home,
  loader: async ({ context }) => {
    if (context.user)
      removeUserFromRoomDB({ data: { roomid: "", userid: context.user.id } });
    const roomList = context.queryClient.ensureQueryData(roomsQueryOptions);
    return { user: context.user, roomList: roomList };
  },
  preload: true,
  shouldReload: true,
});

function Home() {
  const { data: roomList } = useSuspenseQuery(roomsQueryOptions);
  const [searchString, setSearchString] = useState<string | null>(null);

  const getFilteredRooms = (rooms: typeof roomList, search: string | null) => {
    if (search && search.length > 0) {
      // Filter rooms based on the search string
      // Assuming rooms is an array of objects with a 'name' property
      return rooms.filter((room) =>
        room.name.toLowerCase().includes(search.toLowerCase()),
      );
    }
    return rooms;
  };

  const filteredRooms = getFilteredRooms(roomList, searchString);

  return (
    <>
      <SearchBar setSearchString={setSearchString} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredRooms.map((room) => (
          <Link
            to="/room/$roomid"
            params={{
              roomid: room.id,
            }}
            key={room.id}
            className="cursor-pointer"
          >
            <RoomCard room={room} />
          </Link>
        ))}
      </div>
    </>
  );
}
