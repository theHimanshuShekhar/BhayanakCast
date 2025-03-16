import { createServerFn } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import { auth } from "./auth";

export const getUser = createServerFn({ method: "GET" }).handler(async () => {
  const headers = new Headers(getWebRequest()?.headers ?? {});
  const session = await auth.api.getSession({ headers });

  return session?.user || null;
});

export const getOrCreateRoom = createServerFn({ method: "GET" }).handler(async () => {
  return {};
});
