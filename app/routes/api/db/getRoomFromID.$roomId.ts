import { json } from "@tanstack/start";
import { createAPIFileRoute } from "@tanstack/start/api";
import { fetchRoomDataFromID } from "~/lib/server/db/actions";

export const APIRoute = createAPIFileRoute("/api/db/getRoomFromID/$roomId")({
  GET: async ({ params }) => {
    return json(await fetchRoomDataFromID(params.roomId));
  },
});
