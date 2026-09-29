import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "~/db/client";
import { callerFromSession, getSessionFromRequest } from "~/server/session";
import { getThumbnail } from "~/server/thumbnails";

// A streamer's latest thumbnail, for whoever may see the room (ADR 16). Cards add
// `?t=<capturedAt>`, so a new upload is a new URL.
export const Route = createFileRoute("/api/thumbnails/$roomId/$userId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const caller = callerFromSession(await getSessionFromRequest(request));
        const thumbnail = await getThumbnail(getDb(), caller, params.roomId, params.userId);
        if (!thumbnail) return new Response("No thumbnail", { status: 404 });
        return new Response(new Uint8Array(thumbnail.image), {
          headers: {
            "content-type": thumbnail.mime,
            "cache-control": "private, max-age=60",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
