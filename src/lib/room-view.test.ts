import { describe, expect, it } from "vitest";
import { roomDetailFor } from "./room-view";
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
      room({ participants: [viewer, host], streamers: [host], participantCount: 2 }),
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
