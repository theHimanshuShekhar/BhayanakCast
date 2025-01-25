import { json } from "@tanstack/start";
import { createAPIFileRoute } from "@tanstack/start/api";

export const APIRoute = createAPIFileRoute("/api/util/getSocketServerURL")({
  GET: () => {
    return json({ url: process.env.WEBSOCKETSERVER_URL });
  },
});
