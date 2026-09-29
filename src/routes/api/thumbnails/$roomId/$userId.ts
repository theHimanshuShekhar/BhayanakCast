import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "~/db/client";
import { callerFromSession, getSessionFromRequest } from "~/server/session";
import { getThumbnail, thumbnailResponse } from "~/server/thumbnails";

// A streamer's latest thumbnail, for whoever may see the room (ADR 16). Cards add
// `?t=<capturedAt>`, so a new upload is a new URL; the ETag is that time, so a match is a 304.
export const Route = createFileRoute("/api/thumbnails/$roomId/$userId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const caller = callerFromSession(await getSessionFromRequest(request));
        const thumbnail = await getThumbnail(getDb(), caller, params.roomId, params.userId);
        if (!thumbnail) return new Response("No thumbnail", { status: 404 });
        return thumbnailResponse(thumbnail, request.headers.get("if-none-match"));
      },
    },
  },
});
