import { json } from "@tanstack/react-start";
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { removeViewerFromRoom } from "~/lib/server/functions";

export const APIRoute = createAPIFileRoute("/api/room/leave/$userid")({
  GET: async ({ params }) => {
    const { userid } = params;
    await removeViewerFromRoom({ data: userid });
    return json({ status: "success" });
  },
});
