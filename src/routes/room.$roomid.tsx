import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { getRoomFromDB, getServerURL, getUserFromDB } from "~/lib/server/functions";

const cacheTime = 1000 * 5;

export const Route = createFileRoute("/room/$roomid")({
  component: RouteComponent,
  beforeLoad: async ({ context, params }) => {
    if (!context.user) {
      throw redirect({ to: "/" });
    }

    const serverURL = await getServerURL();

    const userQueryOptions = queryOptions({
      queryKey: ["user", context.user.id],
      queryFn: ({ signal, queryKey }) => getUserFromDB({ signal, data: queryKey[1] }),
      staleTime: cacheTime,
      refetchInterval: cacheTime + 1,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: 1000,
    });

    const userFromDB = await context.queryClient.ensureQueryData(userQueryOptions);

    if (!userFromDB || userFromDB.length < 1) {
      throw redirect({ to: "/" });
    }

    const roomID = params.roomid;
    if (!roomID) {
      throw redirect({ to: "/" });
    }
    if (!context.user) {
      throw redirect({ to: "/" });
    }
    const roomQueryOptions = queryOptions({
      queryKey: ["room", roomID, context.user.id, context.user],
      queryFn: ({ signal }) => {
        if (!context.user) return;
        return getRoomFromDB({
          signal,
          data: { roomid: roomID, userid: context.user.id },
        });
      },
      staleTime: cacheTime,
      refetchInterval: cacheTime + 1,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: 1000,
    });

    const roomFromDB = await context.queryClient.ensureQueryData(roomQueryOptions);

    return { userFromDB, roomFromDB, userQueryOptions, roomQueryOptions, serverURL };
  },
  loader: ({ context }) => {
    return {
      userFromDB: context.userFromDB,
      roomFromDB: context.roomFromDB,
      userQueryOptions: context.userQueryOptions,
      roomQueryOptions: context.roomQueryOptions,
      serverURL: context.serverURL,
    };
  },
  preload: true,
  shouldReload: true,
});

function RouteComponent() {
  const { userQueryOptions, roomQueryOptions, serverURL } = Route.useLoaderData();

  const { data: userFromDB } = useSuspenseQuery({
    ...userQueryOptions,
    queryFn: () => getUserFromDB({ data: userQueryOptions.queryKey[1] }),
  });
  const { data: roomFromDB } = useSuspenseQuery({
    ...roomQueryOptions,
    queryFn: () =>
      getRoomFromDB({
        data: {
          roomid: roomQueryOptions.queryKey[1] as string,
          userid: roomQueryOptions.queryKey[2] as string,
        },
      }),
  });

  useEffect(() => {
    if (!userFromDB) {
      console.error("User not found");
      return;
    }
    console.info("Current user", userFromDB);
  }, [userFromDB]);

  if (!roomFromDB) {
    return <div>Room not found</div>;
  }

  return (
    <div className="grow grid grid-cols-3 gap-2 border-2 border-red-500">
      <div className="border-2 border-blue-300 col-span-full md:col-span-2 flex flex-col gap-2">
        <div className="grow border min-h-[240px]">Stream Player</div>
        <div>Streamer and Viewers</div>
      </div>
      <div className="border-2 border-blue-300 flex flex-col col-span-full md:col-span-1 gap-2">
        <div>Stream Info</div>
        <div className="border grow min-h-[300px]">Stream Chat</div>
      </div>
    </div>
  );
}
