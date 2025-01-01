import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import {
  addUserToRoomIfNotExists,
  fetchRoomDataFromID,
  getOrCreateRoom,
} from "~/lib/server/db/actions";

const createRoom = createServerFn({
  method: "GET",
})
  .validator(({ roomid, roomname }: { roomid: string; roomname: string }) => {
    return {
      roomid: roomid,
      roomname: roomname,
    };
  })
  .handler(async (ctx) => {
    // Get existing room or create new room
    const { roomid, roomname } = ctx.data;
    return await getOrCreateRoom(roomid, roomname);
  });

const getRoom = createServerFn({
  method: "GET",
})
  .validator(({ roomid }: { roomid: string }) => {
    return {
      roomid: roomid,
    };
  })
  .handler(async (ctx) => {
    // Get existing room or create new room
    const { roomid } = ctx.data;
    return await fetchRoomDataFromID(roomid);
  });

const addUserToRoom = createServerFn({
  method: "POST",
})
  .validator(({ userUUID, roomUUID }: { userUUID: string; roomUUID: string }) => {
    return {
      userUUID: userUUID,
      roomUUID: roomUUID,
    };
  })
  .handler(async (ctx) => {
    // Get existing room or create new room
    const { userUUID, roomUUID } = ctx.data;
    await addUserToRoomIfNotExists(userUUID, roomUUID);
  });

export const Route = createFileRoute("/room/$roomid/$roomname")({
  component: RoomPageComponent,
  beforeLoad: async ({ context, params }) => {
    // If user is not logged in, redirect to home page
    if (!context.user) {
      throw redirect({
        to: "/",
      });
    }

    const Room = await createRoom({ data: params });
    addUserToRoom({ data: { userUUID: context.user.uuid, roomUUID: Room.uuid } });
  },

  loader: async ({ context, params }) => {
    return {
      user: context.user,
      roomData: await getRoom({
        data: { roomid: params.roomid },
      }),
    };
  },
});

function RoomPageComponent() {
  const { user, roomData } = Route.useLoaderData();

  console.log("CurrentUser", user);

  return (
    <>
      <div className="font-bold">
        <pre>{JSON.stringify(roomData, null, 2)}</pre>
      </div>
    </>
  );
}
