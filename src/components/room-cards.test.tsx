import { describe, expect, it } from "vitest";
import type { LiveRoomCard } from "~/lib/rooms";
import { liveCardLabel } from "./room-cards";

const person = (username: string) => ({ id: username, username, image: null });

const room = (overrides: Partial<LiveRoomCard> = {}): LiveRoomCard => ({
  id: "r1",
  name: "midnight speedrun club",
  description: "",
  kind: "gaming",
  tags: [],
  isPrivate: false,
  host: person("kodama_jpg"),
  participants: [person("kodama_jpg"), person("bitreverb")],
  participantCount: 2,
  capacity: 10,
  streamers: [],
  streamCount: 0,
  createdAt: "2026-09-30T00:00:00.000Z",
  ...overrides,
});

// A screen reader hears what the card shows, not just its title (the name still leads, so
// "Join <name>" finds it).
describe("liveCardLabel", () => {
  it("names the room, its host and how full it is", () => {
    expect(liveCardLabel(room())).toBe(
      "Join midnight speedrun club, hosted by kodama_jpg, 2 of 10 people",
    );
  });

  it("says how many are sharing and that the room is private", () => {
    expect(liveCardLabel(room({ streamCount: 3, isPrivate: true }))).toBe(
      "Join midnight speedrun club, hosted by kodama_jpg, 2 of 10 people, 3 sharing, private",
    );
  });

  it("says a full room means waiting for a spot", () => {
    expect(liveCardLabel(room({ participantCount: 10 }))).toBe(
      "Join midnight speedrun club, hosted by kodama_jpg, full: you'll wait for a spot",
    );
  });

  it("leaves the host out when their account is gone", () => {
    expect(liveCardLabel(room({ host: null }))).toBe("Join midnight speedrun club, 2 of 10 people");
  });
});
