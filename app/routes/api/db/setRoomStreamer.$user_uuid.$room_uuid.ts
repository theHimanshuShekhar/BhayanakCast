import { json } from "@tanstack/start";
import { createAPIFileRoute } from "@tanstack/start/api";
import { setRoomStreamer } from "~/lib/server/db/actions";

export const APIRoute = createAPIFileRoute(
  "/api/db/setRoomStreamer/$user_uuid/$room_uuid",
)({
  GET: async ({ params: { user_uuid, room_uuid } }) => {
    const updatedRoom = await setRoomStreamer(user_uuid, room_uuid);
    return json({ data: updatedRoom });
  },
});
