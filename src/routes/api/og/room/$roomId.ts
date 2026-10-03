import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "~/db/client";
import { roomIdInput } from "~/lib/rooms";
import { cardResponse, roomCardPng, siteImageResponse } from "~/server/og-room";
import { allowPublicRead } from "~/server/request-caller";

// A live public room's share card for link unfurls (ADR 22), at `/api/og/room/<id>.png`: no
// session, whoever asks sees what a visitor sees. The `.png` is part of the segment, so unfurlers
// that judge an image by its URL accept it. Anything else gets the site image, never an error
// an embed would show as a broken picture.
export const Route = createFileRoute("/api/og/room/$roomId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!allowPublicRead(request, "card")) {
          return new Response("Too many requests", {
            status: 429,
            headers: { "retry-after": "60", "cache-control": "private, no-store" },
          });
        }
        const id = roomIdInput.safeParse({ roomId: params.roomId.replace(/\.png$/, "") });
        if (!id.success) return siteImageResponse();
        try {
          const png = await roomCardPng(getDb(), id.data.roomId);
          return png ? cardResponse(png) : siteImageResponse();
        } catch (error) {
          console.error("[og] room card failed", error);
          return siteImageResponse();
        }
      },
    },
  },
});
