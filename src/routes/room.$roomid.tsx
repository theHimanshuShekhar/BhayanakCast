import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRoomFromDB, getUserFromDB } from "~/lib/server/functions";

const cacheTime = 1000 * 5;

export const Route = createFileRoute("/room/$roomid")({
  component: RouteComponent,
  beforeLoad: async ({ context, params }) => {
    // If user is not logged in, redirect to home page
    const userId = context.user?.id;
    if (!context.user) {
      throw redirect({
        to: "/",
      });
    }
    if (!userId) {
      throw redirect({
        to: "/",
      });
    }

    const userQueryOptions = queryOptions({
      queryKey: [userId],
      queryFn: ({ signal }) =>
        getUserFromDB({
          signal,
          data: userId,
        }),

      staleTime: cacheTime,
      gcTime: cacheTime,
      refetchInterval: cacheTime,
      refetchOnWindowFocus: true,
    });

    // Get currently logged in user
    const userFromDB = await context.queryClient.ensureQueryData(userQueryOptions);
    if (!userFromDB)
      throw redirect({
        to: "/",
      });

    const roomID = params.roomid;

    const roomQUeryOptions = queryOptions({
      queryKey: [roomID, userId],
      queryFn: ({ signal }) =>
        getRoomFromDB({
          signal,
          data: { roomid: roomID, userid: userId },
        }),
      staleTime: cacheTime,
      gcTime: cacheTime,
      refetchInterval: cacheTime,
      refetchOnWindowFocus: true,
    });

    const roomFromDB = await context.queryClient.ensureQueryData(roomQUeryOptions);

    return { userFromDB, roomFromDB, userQueryOptions, roomQUeryOptions };
  },
  loader: ({ context }) => {
    return {
      user: context.userFromDB,
      room: context.roomFromDB,
      userQueryOptions: context.userQueryOptions,
      roomQueryOptions: context.roomQUeryOptions,
    };
  },
  preload: true,
  shouldReload: true,
});

function RouteComponent() {
  const { userQueryOptions, roomQueryOptions } = Route.useLoaderData();

  const { data: user } = useSuspenseQuery(userQueryOptions);
  const { data: room } = useSuspenseQuery(roomQueryOptions);

  return (
    <>
      <div>
        <pre>{JSON.stringify(user, null, 2)}</pre>
      </div>
      <div>
        <pre>{JSON.stringify(room, null, 2)}</pre>
      </div>
    </>
  );
}
