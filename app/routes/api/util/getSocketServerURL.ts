import { json } from "@tanstack/react-start";
import { createAPIFileRoute } from "@tanstack/react-start/api";

export const APIRoute = createAPIFileRoute("/api/util/getSocketServerURL")({
  GET: () => {
    return json({ url: process.env.WEBSOCKETSERVER_URL });
  },
});
