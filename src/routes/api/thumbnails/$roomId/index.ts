import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "~/db/client";
import { THUMBNAIL_MAX_BYTES } from "~/lib/thumbnails";
import { requireSignedIn, SignInRequiredError } from "~/server/caller";
import { announceRoom } from "~/server/room-announcements";
import { callerFromSession, getSessionFromRequest } from "~/server/session";
import {
  InvalidThumbnailError,
  isSameOrigin,
  mayUpload,
  NotStreamingError,
  readBodyCapped,
  uploadThumbnail,
} from "~/server/thumbnails";

const fail = (status: number, error: string) => Response.json({ error }, { status });

// A streamer uploads the raw image of their own screen for this room (ADR 10).
export const Route = createFileRoute("/api/thumbnails/$roomId/")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isSameOrigin(request)) return fail(403, "Forbidden");
        try {
          const caller = callerFromSession(await getSessionFromRequest(request));
          requireSignedIn(caller);
          if (!mayUpload(caller.user.id)) return fail(429, "Too many thumbnails, slow down");
          if (Number(request.headers.get("content-length")) > THUMBNAIL_MAX_BYTES) {
            return fail(413, "Thumbnail too large");
          }
          const bytes = await readBodyCapped(request, THUMBNAIL_MAX_BYTES);
          if (!bytes) return fail(413, "Thumbnail too large");
          const stored = await uploadThumbnail(getDb(), caller, {
            roomId: params.roomId,
            contentType: request.headers.get("content-type"),
            bytes,
          });
          // After the commit, so lists refetched on the lobby's word carry the new image.
          announceRoom({ kind: "thumbnail", roomId: params.roomId });
          return Response.json(stored);
        } catch (error) {
          if (error instanceof SignInRequiredError) return fail(401, error.message);
          if (error instanceof NotStreamingError) return fail(403, error.message);
          if (error instanceof InvalidThumbnailError) {
            return fail(error.reason === "size" ? 413 : 415, error.message);
          }
          throw error;
        }
      },
    },
  },
});
