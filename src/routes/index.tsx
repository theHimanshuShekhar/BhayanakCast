import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { SearchBar } from "~/lib/components/Search";
import { getRoomsFromDB } from "~/lib/server/functions";

const cacheTime = 1000 * 2;

const roomsQueryOptions = queryOptions({
  queryKey: [],
  queryFn: () => getRoomsFromDB(),
  staleTime: cacheTime,
  gcTime: cacheTime,
});

export const Route = createFileRoute("/")({
  component: Home,
  loader: async ({ context }) => {
    const roomList = context.queryClient.ensureQueryData(roomsQueryOptions);
    return { user: context.user, roomList: roomList };
  },
  preload: true,
  shouldReload: true,
});

function Home() {
  const { data: roomList } = useSuspenseQuery(roomsQueryOptions);
  return (
    <>
      <SearchBar />
      <div className="grid grid-cols-3 gap-4 border ">
        {roomList.map((room) => (
          <div
            className="flex flex-col text-sm items-center text-center p-2 border-4 border-purple-500"
            key={room.id}
          >
            <div className="font-semibold text-xl">{room.name}</div>
            <div>{room.description}</div>
            <div>{room.createdAt.toDateString()}</div>
          </div>
        ))}
      </div>
    </>
  );
}
