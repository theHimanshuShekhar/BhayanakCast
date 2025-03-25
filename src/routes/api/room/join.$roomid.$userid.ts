import { json } from "@tanstack/react-start";
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { addViewerToRoom } from "~/lib/server/functions";

export const APIRoute = createAPIFileRoute("/api/room/join/$roomid/$userid")({
  GET: async ({ params }) => {
    const { roomid, userid } = params;
    await addViewerToRoom({ data: { roomId: roomid, userId: userid } });
    return json({ status: "success", message: "Viewer added to room" });
  },
});
