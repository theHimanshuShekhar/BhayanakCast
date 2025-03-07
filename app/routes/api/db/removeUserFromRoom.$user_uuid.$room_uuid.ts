import { json } from "@tanstack/react-start";
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { removeUserFromRoomByUUID } from "~/lib/server/db/actions";

export const APIRoute = createAPIFileRoute(
  "/api/db/removeUserFromRoom/$user_uuid/$room_uuid",
)({
  GET: async ({ params }) => {
    return json({
      res: await removeUserFromRoomByUUID(params.user_uuid, params.room_uuid),
    });
  },
});
