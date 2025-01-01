import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  addUserToRoomIfNotExists,
  fetchRoomDataFromName,
  getOrCreateRoom,
} from "~/lib/server/db/actions";

export const Route = createFileRoute("/room/$roomid/$roomname")({
  component: RoomPageComponent,
  beforeLoad: async ({ context, params }) => {
    // If user is not logged in, redirect to home page
    if (!context.user) {
      throw redirect({
        to: "/",
      });
    }

    // Get existing room or create new room
    const roomData = await getOrCreateRoom(params.roomid, params.roomname);

    // Add user to room
    await addUserToRoomIfNotExists(context.user.uuid, roomData.uuid);

    // Reroute to room
    if (roomData.uuid !== params.roomid)
      throw redirect({
        to: `/room/${roomData.uuid}/${roomData.name}`,
      });

    // Return logged in user and roomData to RoomPageComponent
    return { user: context.user };
  },
  loader: async ({ params }) => {
    return await fetchRoomDataFromName(params.roomname);
  },
});

function RoomPageComponent() {
  const { user } = Route.useRouteContext();
  const roomData = Route.useLoaderData();

  console.log("CurrentUser", user);

  return (
    <>
      <div className="font-bold">
        Room: <pre>{JSON.stringify(roomData, null, 2)}</pre>
      </div>
    </>
  );
}
