import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import debounce from "lodash/debounce";
import { useCallback, useState } from "react";
import { CreateRoom } from "~/lib/components/CreateRoom";
import { RoomCard } from "~/lib/components/RoomCard";
import { SearchBar } from "~/lib/components/Search";
import { getRoomsFromDB } from "~/lib/server/functions";
import type { RoomWithViewers } from "~/lib/types";

const cacheTime = 1000 * 15;

const roomsQueryOptions = queryOptions({
  queryKey: ["rooms"],
  queryFn: async () => {
    const rooms = await getRoomsFromDB();
    return rooms;
  },
  staleTime: cacheTime,
  gcTime: cacheTime,
  refetchInterval: cacheTime,
  refetchOnWindowFocus: true,
});

export const Route = createFileRoute("/")({
  component: Home,
  loader: async ({ context }) => {
    const roomList = await context.queryClient.ensureQueryData(roomsQueryOptions);
    return { user: context.user, roomList: roomList };
  },
  preload: true,
  shouldReload: true,
});

function Home() {
  const { data: roomList } = useSuspenseQuery(roomsQueryOptions);
  const [searchString, setSearchString] = useState<string | null>(null);

  const debouncedSetSearch = useCallback((value: string | null) => {
    const fn = debounce((v: string | null) => setSearchString(v), 300);
    fn(value);
  }, []);

  const getFilteredRooms = (rooms: RoomWithViewers[], search: string | null) => {
    if (!search) return rooms;
    const searchLower = search.toLowerCase();
    return rooms.filter((room) => room.name.toLowerCase().includes(searchLower));
  };

  const filteredRooms = getFilteredRooms(roomList, searchString);

  const { user } = Route.useLoaderData();

  return (
    <>
      <SearchBar setSearchString={debouncedSetSearch} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredRooms.length === 0 && (
          <div className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-4 flex flex-col items-center justify-center p-4 rounded-lg gap-4">
            <p className="text-center text-gray-500">No rooms found</p>
            {user && <CreateRoom initialRoomName={searchString} />}
          </div>
        )}
        {filteredRooms.map((room) => (
          <Link
            to="/room/$roomid"
            params={{
              roomid: room.id,
            }}
            preload={false}
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
