import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "~/db/client";
import { roomIdInput } from "~/lib/rooms";
import { cardResponse, siteImageResponse } from "~/server/og-response";
import { allowPublicRead } from "~/server/request-caller";

// A live public room's share card for link unfurls (ADR 22), at `/api/og/room/<id>.png`: no
// session, whoever asks sees what a visitor sees. The `.png` is part of the segment, so unfurlers
// that judge an image by its URL accept it. Anything else gets the site image, never an error
// an embed would show as a broken picture: not a private, ended or unknown room, not a render
// that failed, and not a client over its budget (the fallback is a cheap redirect that names
// nothing, and a cached card shouldn't 429 a crawler behind a shared egress IP).
export const Route = createFileRoute("/api/og/room/$roomId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!allowPublicRead(request, "card")) return siteImageResponse();
        const id = roomIdInput.safeParse({ roomId: params.roomId.replace(/\.png$/, "") });
        if (!id.success) return siteImageResponse();
        try {
          // Loaded here, not at the top: satori, resvg and libwebp stay out of every page's
          // server bundle, and a native library that won't load breaks only cards.
          const { roomCardPng } = await import("~/server/og-room");
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
