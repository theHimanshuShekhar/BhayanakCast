/**
 * Private-room invites (ADR 16), client-safe half: the inputs and views the invite server
 * functions use (src/server/invites.ts). The invite link is `/join/<inviteToken>`; opening it
 * lets a signed-in user knock (`knock.request`, src/lib/realtime.ts).
 */
import { z } from "zod";

/** A private room's invite token, as the invite link and `knock.request` carry it. */
export const inviteToken = z.string().min(1).max(128);

export const inviteTokenInput = z.object({ inviteToken });

/** The private room an invite link opens, as its knock screen shows it. */
export interface InvitedRoom {
  roomId: string;
  name: string;
}

/** The path of the invite link for `inviteToken`. */
export function invitePath(inviteToken: string): string {
  return `/join/${encodeURIComponent(inviteToken)}`;
}

/** The invite link for `inviteToken` on the site at `origin`. */
export function inviteUrl(origin: string, inviteToken: string): string {
  return `${origin}${invitePath(inviteToken)}`;
}
