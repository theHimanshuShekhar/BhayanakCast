import { createAPIFileRoute } from "@tanstack/react-start/api";
import { deleteCookie, setHeader } from "vinxi/http";
import {
  getAuthSession,
  invalidateSession,
  SESSION_COOKIE_NAME,
} from "~/lib/server/auth";

export const APIRoute = createAPIFileRoute("/api/auth/logout")({
  POST: async () => {
    setHeader("Location", "/");

    const { session } = await getAuthSession({ refreshCookie: false });
    if (!session) {
      return new Response(null, {
        status: 401,
      });
    }

    deleteCookie(SESSION_COOKIE_NAME);
    await invalidateSession(session.id);

    return new Response(null, {
      status: 302,
    });
  },
});
