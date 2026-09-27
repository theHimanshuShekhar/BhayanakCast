/**
 * The caller of the current server-function request, from its session cookie.
 * Server-only: call it inside `createServerFn` handlers.
 */
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { Caller } from "./caller.ts";
import { callerFromSession, getSessionFromRequest } from "./session.ts";

export async function getCaller(): Promise<Caller> {
  return callerFromSession(await getSessionFromRequest(getRequestHeaders()));
}
