import { json } from "@tanstack/start";
import { createAPIFileRoute } from "@tanstack/start/api";
import { addUserToRoomIfNotExists } from "~/lib/server/db/actions";

export const APIRoute = createAPIFileRoute("/api/db/addUserToRoom/$user_uuid/$room_uuid")(
  {
    GET: async ({ params: { user_uuid, room_uuid } }) => {
      const newRelation = await addUserToRoomIfNotExists(user_uuid, room_uuid);
      return json({ data: newRelation });
    },
  },
);
