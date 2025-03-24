import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import debounce from "lodash/debounce";
import { useCallback, useState } from "react";
import { RoomCard } from "~/lib/components/RoomCard";
import { SearchBar } from "~/lib/components/Search";
import { getRoomsFromDB, removeUserFromRoomDB } from "~/lib/server/functions";
import type { RoomBase } from "~/lib/types";

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
    // Only remove user from room if they were previously in one
    const user = context.user;
    if (user?.id) {
      await removeUserFromRoomDB({ data: { roomid: "", userid: user.id } });
    }
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

  const getFilteredRooms = (rooms: RoomBase[], search: string | null) => {
    if (!search) return rooms;
    const searchLower = search.toLowerCase();
    return rooms.filter((room) => room.name.toLowerCase().includes(searchLower));
  };

  const filteredRooms = getFilteredRooms(roomList, searchString);

  return (
    <>
      <SearchBar setSearchString={debouncedSetSearch} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
