/**
 * The caller of the current server-function request, from its session cookie.
 * Server-only: call it inside `createServerFn` handlers.
 */
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { Caller } from "./caller.ts";
import { getSessionFromRequest } from "./session.ts";

export async function getCaller(): Promise<Caller> {
  const session = await getSessionFromRequest(getRequestHeaders());
  if (!session) return { user: null, role: "visitor" };
  const { id, name, discordUsername, role } = session.user;
  return {
    user: { id, username: discordUsername ?? name },
    role: role === "admin" ? "admin" : "user",
  };
}
