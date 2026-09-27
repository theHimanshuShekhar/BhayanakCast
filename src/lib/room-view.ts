/**
 * The room page's starting view, built from the room as the loader returns it: until the
 * realtime socket's snapshot arrives (then `withRoster` takes over), the people in the room are
 * its open presence intervals, plus the signed-in user, who is on the page and is joining.
 * Nobody's mic or camera is known yet, so everyone starts muted with the camera off. Streamers
 * (open stream
 * intervals) get the big tiles, other people small ones (so they can be pinned, muted and
 * moderated), and the signed-in user is a viewer until they turn on their camera or share.
 */
import type { RoomParticipant } from "./realtime";
import type { LiveRoomCard, RoomPerson } from "./rooms";
import type { Participant, RoomDetail } from "./types";

export function roomDetailFor(room: LiveRoomCard, me: RoomPerson | null): RoomDetail {
  const hostId = room.host?.id ?? null;
  const streaming = new Set(room.streamers.map((s) => s.id));
  const people = [...room.participants];
  if (me && !people.some((p) => p.id === me.id)) people.push(me);
  // Streamers first, then everyone else, each in order of arrival.
  const ordered = [
    ...people.filter((p) => streaming.has(p.id)),
    ...people.filter((p) => !streaming.has(p.id)),
  ];
  const participants = ordered.map((p, i): Participant => {
    const you = p.id === me?.id;
    const tile: Pick<Participant, "size" | "screen" | "viewerOnly"> = streaming.has(p.id)
      ? { size: i === 0 ? "l" : "m", screen: "browser" }
      : // You're a viewer until you turn on your camera or share; others get a small tile.
        you
        ? { viewerOnly: true }
        : { size: "s" };
    return {
      id: p.id,
      userId: p.id,
      name: p.username,
      role: p.id === hostId ? "host" : "member",
      streaming: streaming.has(p.id),
      speaking: false,
      muted: true,
      camera: false,
      ...tile,
      you,
    };
  });
  return {
    id: room.id,
    name: room.name,
    host: room.host?.username ?? null,
    hostId,
    capacity: room.capacity,
    createdAt: room.createdAt,
    participants,
  };
}

/**
 * The room's people once the realtime server says who is there (`room.snapshot` and
 * `room.event`): `roster` decides who is present and their name and role; people already
 * shown keep their place and local state (tile size, mic, camera), newcomers join at the end
 * on a small tile, and you (`meId`) as a viewer.
 */
export function withRoster(
  shown: Participant[],
  roster: RoomParticipant[],
  meId: string | null,
): Participant[] {
  const byUser = new Map(roster.map((p) => [p.userId, p]));
  const kept = shown.flatMap((p): Participant[] => {
    const live = byUser.get(p.userId);
    return live ? [{ ...p, name: live.username, role: live.role }] : [];
  });
  const keptIds = new Set(kept.map((p) => p.userId));
  const added = roster
    .filter((p) => !keptIds.has(p.userId))
    .map((p): Participant => {
      const you = p.userId === meId;
      return {
        id: p.userId,
        userId: p.userId,
        name: p.username,
        role: p.role,
        streaming: false,
        speaking: false,
        muted: true,
        camera: false,
        ...(you ? { viewerOnly: true } : { size: "s" }),
        you,
      };
    });
  return [...kept, ...added];
}
