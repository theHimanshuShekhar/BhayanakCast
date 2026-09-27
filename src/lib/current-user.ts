/**
 * Who is using the app: a visitor (signed out), a user, or an admin. The root
 * route loads this server-side on every navigation and puts it in router
 * context, so SSR and guards know the answer without a client-side flash.
 * Route guards are a UX nicety; server functions enforce access themselves.
 */
import { useRouteContext } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getSessionFromRequest } from "~/server/session";

export type Role = "visitor" | "user" | "admin";

export interface CurrentUser {
  id: string;
  /** Discord username; shown in the rail and used for avatar initials. */
  username: string;
}

export interface CurrentSession {
  user: CurrentUser | null;
  role: Role;
}

export const VISITOR: CurrentSession = { user: null, role: "visitor" };

export const loadCurrentSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<CurrentSession> => {
    const session = await getSessionFromRequest(getRequestHeaders());
    if (!session) return VISITOR;
    const { id, name, discordUsername, role } = session.user;
    return {
      user: { id, username: discordUsername ?? name },
      role: role === "admin" ? "admin" : "user",
    };
  },
);

export function useCurrentSession(): CurrentSession {
  return useRouteContext({ from: "__root__", select: (context) => context.session });
}
