/**
 * Who is using the app: a visitor (signed out), a user, or an admin. The root
 * route loads this server-side on every navigation and puts it in router
 * context, so SSR and guards know the answer without a client-side flash.
 * Route guards are a UX nicety; server functions enforce access themselves.
 */
import { useRouteContext } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCaller } from "~/server/request-caller";

export type Role = "visitor" | "user" | "admin";

export interface CurrentUser {
  id: string;
  /** Discord username; shown in the rail and used for avatar initials. */
  username: string;
  /** Their Discord picture as stored at sign-in (null if none). */
  image: string | null;
}

export interface CurrentSession {
  user: CurrentUser | null;
  role: Role;
}

export const VISITOR: CurrentSession = { user: null, role: "visitor" };

export const loadCurrentSession = createServerFn({ method: "GET" }).handler(
  (): Promise<CurrentSession> => getCaller(),
);

export function useCurrentSession(): CurrentSession {
  return useRouteContext({ from: "__root__", select: (context) => context.session });
}
