import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  getRoomFromDB,
  getUserFromDB,
  removeUserFromRoomDB,
} from "~/lib/server/functions";

const cacheTime = 1000 * 2;

export const Route = createFileRoute("/room/$roomid")({
  component: RouteComponent,
  beforeLoad: async ({ context, params }) => {
    if (!context.user) {
      throw redirect({ to: "/" });
    }

    const userQueryOptions = queryOptions({
      queryKey: ["user", context.user.id],
      queryFn: ({ signal, queryKey }) => getUserFromDB({ signal, data: queryKey[1] }),
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
  onLeave: ({ context, params }) => {
    if (!context.user) return;
    removeUserFromRoomDB({
      data: { roomid: params.roomid, userid: context.user.id },
    });
  },
  preload: true,
  shouldReload: true,
});

function RouteComponent() {
  const { userQueryOptions, roomQueryOptions } = Route.useLoaderData();

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
    <div className="room-container">
      <pre>{JSON.stringify(roomFromDB, null, 2)}</pre>
    </div>
  );
}
