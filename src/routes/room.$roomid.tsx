import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRoomFromDB, getUserFromDB } from "~/lib/server/functions";

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

    // Get currently logged in user
    const userFromDB = await context.queryClient.fetchQuery({
      queryKey: [userId],
      queryFn: ({ signal }) =>
        getUserFromDB({
          signal,
          data: userId,
        }),
    });
    if (!userFromDB)
      throw redirect({
        to: "/",
      });

    const roomID = params.roomid;
    const roomFromDB = await context.queryClient.fetchQuery({
      queryKey: [roomID, userId],
      queryFn: ({ signal }) =>
        getRoomFromDB({
          signal,
          data: { roomid: roomID, userid: userId },
        }),
    });

    return { userFromDB, roomFromDB };
  },
  loader: ({ context }) => {
    return { user: context.userFromDB, room: context.roomFromDB };
  },
});

function RouteComponent() {
  const { user, room } = Route.useLoaderData();

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
