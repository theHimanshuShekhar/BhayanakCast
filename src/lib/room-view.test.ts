import { describe, expect, it } from "vitest";
import type { RoomParticipant } from "./realtime";
import { roomDetailFor, withRoster } from "./room-view";
import type { LiveRoomCard } from "./rooms";

const host = { id: "u-host", username: "host.discord" };
const viewer = { id: "u-viewer", username: "viewer.discord" };
const me = { id: "u-me", username: "me.discord" };

const room = (overrides: Partial<LiveRoomCard> = {}): LiveRoomCard => ({
  id: "room-1",
  name: "sunday synth jams",
  description: "",
  kind: "music",
  tags: [],
  isPrivate: false,
  host,
  participants: [],
  participantCount: 0,
  capacity: 10,
  streamers: [],
  streamCount: 0,
  createdAt: "2026-09-27T10:00:00.000Z",
  ...overrides,
});

describe("roomDetailFor", () => {
  it("shows an empty room as just the signed-in user", () => {
    const detail = roomDetailFor(room(), me);
    expect(detail).toMatchObject({
      id: "room-1",
      name: "sunday synth jams",
      host: "host.discord",
      hostId: "u-host",
      capacity: 10,
      createdAt: "2026-09-27T10:00:00.000Z",
    });
    expect(detail.participants).toEqual([
      expect.objectContaining({ userId: "u-me", name: "me.discord", role: "member", you: true }),
    ]);
  });

  it("puts streamers first on big tiles, others on small ones, and you in the viewers", () => {
    const detail = roomDetailFor(
      room({
        participants: [viewer, host],
        streamers: [{ ...host, thumbnailAt: null }],
        participantCount: 2,
      }),
      me,
    );
    expect(
      detail.participants.map((p) => [p.name, p.role, p.streaming, p.size, !!p.viewerOnly]),
    ).toEqual([
      ["host.discord", "host", true, "l", false],
      ["viewer.discord", "member", false, "s", false],
      ["me.discord", "member", false, undefined, true],
    ]);
    expect(detail.participants.filter((p) => p.you).map((p) => p.userId)).toEqual(["u-me"]);
  });

  it("doesn't add the signed-in user twice when they're already present", () => {
    const detail = roomDetailFor(room({ participants: [host], participantCount: 1 }), host);
    expect(detail.participants).toEqual([
      expect.objectContaining({ userId: "u-host", role: "host", you: true }),
    ]);
  });

  it("handles a room whose host account is gone", () => {
    const detail = roomDetailFor(room({ host: null }), me);
    expect(detail).toMatchObject({ host: null, hostId: null });
  });
});

describe("withRoster", () => {
  const live = (
    person: { id: string; username: string },
    role: RoomParticipant["role"],
    media: Partial<RoomParticipant["media"]> = {},
  ): RoomParticipant => ({
    userId: person.id,
    username: person.username,
    role,
    joinedAt: "2026-09-27T10:00:00.000Z",
    media: { mic: false, cam: false, share: false, ...media },
  });

  it("keeps who the server says is there, in place, and adds newcomers at the end", () => {
    const shown = roomDetailFor(
      room({
        participants: [host, viewer],
        streamers: [{ ...host, thumbnailAt: null }],
        participantCount: 2,
      }),
      me,
    ).participants;
    const next = withRoster(
      shown,
      [
        live(me, "member"),
        live(host, "host", { share: true }),
        live({ id: "u-new", username: "new" }, "member"),
      ],
      me.id,
    );
    expect(next.map((p) => [p.name, p.role, p.streaming, p.size, !!p.viewerOnly])).toEqual([
      ["host.discord", "host", true, "l", false],
      ["me.discord", "member", false, undefined, true],
      ["new", "member", false, "s", false],
    ]);
  });

  it("follows everyone's mic, camera and share from the server", () => {
    const shown = withRoster([], [live(host, "host"), live(me, "member")], me.id);
    const next = withRoster(
      shown,
      [live(host, "host", { mic: true, share: true }), live(me, "member", { cam: true })],
      me.id,
    );
    expect(
      next.map((p) => [p.name, p.muted, p.camera, p.streaming, p.size, !!p.viewerOnly]),
    ).toEqual([
      ["host.discord", false, false, true, "l", false],
      ["me.discord", true, true, false, "s", false],
    ]);
    // A second streamer gets a medium tile; stopping puts you back to a viewer.
    const later = withRoster(
      next,
      [live(host, "host", { share: true }), live(me, "member", { share: true })],
      me.id,
    );
    expect(later.map((p) => [p.streaming, p.size, p.screen])).toEqual([
      [true, "l", "browser"],
      [true, "m", "browser"],
    ]);
    const done = withRoster(later, [live(host, "host"), live(me, "member")], me.id);
    expect(done.map((p) => [p.streaming, p.size, !!p.viewerOnly])).toEqual([
      [false, "s", false],
      [false, undefined, true],
    ]);
  });

  it("adds you as a viewer when you weren't shown yet", () => {
    expect(withRoster([], [live(me, "member")], me.id)).toEqual([
      expect.objectContaining({ userId: "u-me", you: true, viewerOnly: true }),
    ]);
  });
});
