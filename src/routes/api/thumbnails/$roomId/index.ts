import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "~/db/client";
import { THUMBNAIL_MAX_BYTES } from "~/lib/thumbnails";
import { requireSignedIn } from "~/server/caller";
import { announceRoom } from "~/server/room-announcements";
import { callerFromSession, getSessionFromRequest } from "~/server/session";
import {
  isSameOrigin,
  mayUpload,
  readBodyCapped,
  refuseUpload,
  uploadFailureResponse,
  uploadThumbnail,
} from "~/server/thumbnails";

// A streamer uploads the raw image of their own screen for this room (ADR 10). Every refusal and
// failure is logged (`thumbnail.upload_refused` / `thumbnail.upload_failed`): the page doesn't
// show a failed upload, so the log is where it shows.
export const Route = createFileRoute("/api/thumbnails/$roomId/")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { roomId } = params;
        if (!isSameOrigin(request)) return refuseUpload(403, "Forbidden", { roomId });
        let userId: string | undefined;
        try {
          const caller = callerFromSession(await getSessionFromRequest(request));
          requireSignedIn(caller);
          userId = caller.user.id;
          const who = { roomId, userId };
          if (!mayUpload(userId)) return refuseUpload(429, "Too many thumbnails, slow down", who);
          if (Number(request.headers.get("content-length")) > THUMBNAIL_MAX_BYTES) {
            return refuseUpload(413, "Thumbnail too large", who);
          }
          const bytes = await readBodyCapped(request, THUMBNAIL_MAX_BYTES);
          if (!bytes) return refuseUpload(413, "Thumbnail too large", who);
          const stored = await uploadThumbnail(getDb(), caller, {
            roomId,
            contentType: request.headers.get("content-type"),
            bytes,
          });
          // After the commit, so lists refetched on the lobby's word carry the new image.
          announceRoom({ kind: "thumbnail", roomId });
          return Response.json(stored);
        } catch (error) {
          return uploadFailureResponse(error, { roomId, userId });
        }
      },
    },
  },
});
