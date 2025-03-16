import { createFileRoute, redirect } from "@tanstack/react-router";
import { getOrCreateRoom, getUser } from "~/lib/server/functions";

export const Route = createFileRoute("/room/$roomid")({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    // If user is not logged in, redirect to home page
    if (!context.user) {
      throw redirect({
        to: "/",
      });
    }
    // Get currently logged in user
    const user = await context.queryClient.fetchQuery({
      queryKey: ["user"],
      queryFn: ({ signal }) => getUser({ signal }),
    });

    // Get or Create room
    const room = await context.queryClient.fetchQuery({
      queryKey: ["room"],
      queryFn: ({ signal }) => getOrCreateRoom({ signal }),
    });

    return { user, room };
  },
  loader: ({ context }) => {
    return { user: context.user, room: context.room };
  },
});

function RouteComponent() {
  const { user, room } = Route.useLoaderData();

  return (
    <div>
      <pre>{JSON.stringify(user, null, 2)}</pre>
      <div>
        Hello "/room/{room.id}/{room.name}"!
      </div>
    </div>
  );
}
