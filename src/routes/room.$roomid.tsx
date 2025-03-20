import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  getRoomFromDB,
  getUserFromDB,
  removeUserFromRoomDB,
} from "~/lib/server/functions";

const cacheTime = 1000 * 10;

export const Route = createFileRoute("/room/$roomid")({
  component: RouteComponent,
  beforeLoad: async ({ context, params }) => {
    context.queryClient.invalidateQueries();

    if (!context.user?.id) {
      throw redirect({ to: "/" });
    }

    const userQueryOptions = queryOptions({
      queryKey: [context.user.id],
      queryFn: ({ signal, queryKey }) => getUserFromDB({ signal, data: queryKey[0] }),
      staleTime: cacheTime,
      gcTime: cacheTime,
      refetchInterval: cacheTime,
      refetchOnWindowFocus: true,
    });

    const userFromDB = await context.queryClient.ensureQueryData(userQueryOptions);

    if (!userFromDB || userFromDB.length < 1) {
      throw redirect({ to: "/" });
    }

    const roomID = params.roomid;

    const roomQueryOptions = queryOptions({
      queryKey: [roomID, context.user.id],
      queryFn: ({ signal, queryKey }) =>
        getRoomFromDB({
          signal,
          data: { roomid: queryKey[0], userid: queryKey[1] },
        }),
      staleTime: cacheTime,
      gcTime: cacheTime,
      refetchInterval: cacheTime,
      refetchOnWindowFocus: true,
    });

    const roomFromDB = await context.queryClient.ensureQueryData(roomQueryOptions);

    return { userFromDB, roomFromDB, userQueryOptions, roomQueryOptions };
  },
  loader: ({ context }) => {
    return {
      userFromDB: context.userFromDB,
      roomFromDB: context.roomFromDB,
      userQueryOptions: context.userQueryOptions,
      roomQueryOptions: context.roomQueryOptions,
    };
  },
  onLeave: async ({ context, params }) => {
    if (!context.user) return;
    await removeUserFromRoomDB({
      data: { roomid: params.roomid, userid: context.user.id },
    });

    context.queryClient.invalidateQueries({
      queryKey: [params.roomid, context.user.id],
    });
    context.queryClient.invalidateQueries({
      queryKey: [context.user.id],
    });
  },
  preload: true,
  shouldReload: true,
});

function RouteComponent() {
  const { userQueryOptions, roomQueryOptions } = Route.useLoaderData();

  const { data: userFromDB } = useSuspenseQuery(userQueryOptions);
  const { data: roomFromDB } = useSuspenseQuery(roomQueryOptions);

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
    <div className="room-container">
      <pre>{JSON.stringify(roomFromDB, null, 2)}</pre>
    </div>
  );
}
