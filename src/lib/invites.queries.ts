/** Invite query keys and options (see rooms.queries.ts for the pattern). */
import { queryOptions } from "@tanstack/react-query";
import { resolveInviteFn } from "./invites.functions";

export const inviteKeys = {
  all: ["invites"] as const,
  detail: (inviteToken: string) => [...inviteKeys.all, inviteToken] as const,
};

/** The live private room an invite link opens; `null` when the link is no longer valid. */
export const inviteQuery = (inviteToken: string) =>
  queryOptions({
    queryKey: inviteKeys.detail(inviteToken),
    queryFn: () => resolveInviteFn({ data: { inviteToken } }),
  });
