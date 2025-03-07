import { json } from "@tanstack/react-start";
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { fetchRoomDataFromID } from "~/lib/server/db/actions";

export const APIRoute = createAPIFileRoute("/api/db/getRoomFromID/$roomId")({
  GET: async ({ params }) => {
    return json(await fetchRoomDataFromID(params.roomId));
  },
});
