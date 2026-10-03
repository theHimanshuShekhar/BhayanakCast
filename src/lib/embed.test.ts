import { describe, expect, it } from "vitest";
import {
  type MetaTag,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  privateRoomMeta,
  profileMeta,
  recapMeta,
  roomImagePath,
  roomMeta,
  SITE_IMAGE_PATH,
  siteMeta,
  THEME_COLOR,
  unavailableRoomMeta,
} from "./embed";
import type { Profile } from "./profiles";
import type { Recap } from "./recaps";
import type { LiveRoomCard } from "./rooms";

const ORIGIN = "https://cast.example.test";
// The strings a private room must never put in a tag.
const SECRET_NAME = "secret-roast-night";
const SECRET_HOST = "hush.host";
const TOKEN = "tok_abcDEF123456";

/** The `content` of the tag named or propertied `key`, or undefined. */
const tag = (meta: MetaTag[], key: string) =>
  meta.find((m) => m.name === key || m.property === key)?.content;
const title = (meta: MetaTag[]) => meta.find((m) => "title" in m)?.title;
const everything = (meta: MetaTag[]) => JSON.stringify(meta);

const room = (overrides: Partial<LiveRoomCard> = {}): LiveRoomCard => ({
  id: "r_public1",
  name: "Friday ranked grind",
  description: "",
  kind: "gaming",
  tags: [],
  isPrivate: false,
  host: { id: "u1", username: "nebula.wav", image: null },
  participants: [],
  participantCount: 7,
  capacity: 10,
  streamers: [],
  streamCount: 0,
  createdAt: "2026-10-03T10:00:00.000Z",
  ...overrides,
});

/** Every page carries these, whatever it is about. */
function expectFullEmbed(meta: MetaTag[], url: string) {
  expect(tag(meta, "description")).toBeTruthy();
  expect(tag(meta, "theme-color")).toBe(THEME_COLOR);
  expect(tag(meta, "og:type")).toBe("website");
  expect(tag(meta, "og:site_name")).toBe("BhayanakCast");
  expect(tag(meta, "og:title")).toBeTruthy();
  expect(tag(meta, "og:description")).toBe(tag(meta, "description"));
  expect(tag(meta, "og:url")).toBe(url);
  expect(tag(meta, "og:image")).toMatch(/^https:\/\/cast\.example\.test\//);
  expect(tag(meta, "og:image:type")).toBe("image/png");
  expect(tag(meta, "og:image:width")).toBe("1200");
  expect(tag(meta, "og:image:height")).toBe("630");
  expect(tag(meta, "og:image:alt")).toBeTruthy();
  expect(tag(meta, "twitter:card")).toBe("summary_large_image");
  expect(tag(meta, "twitter:title")).toBe(tag(meta, "og:title"));
  expect(tag(meta, "twitter:description")).toBe(tag(meta, "og:description"));
  expect(tag(meta, "twitter:image")).toBe(tag(meta, "og:image"));
  expect(tag(meta, "twitter:image:alt")).toBe(tag(meta, "og:image:alt"));
  expect(title(meta)).toBeTruthy();
}

describe("the image size the tags declare", () => {
  it("is 1200x630", () => {
    expect([OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT]).toEqual([1200, 630]);
  });
});

describe("the site's tags", () => {
  const meta = siteMeta(ORIGIN);

  it("carry the full Open Graph, Twitter, description and theme-colour set", () => {
    expectFullEmbed(meta, `${ORIGIN}/`);
  });

  it("point at the committed share image, absolute on the configured origin", () => {
    expect(tag(meta, "og:image")).toBe(`${ORIGIN}${SITE_IMAGE_PATH}`);
    expect(SITE_IMAGE_PATH).toBe("/og-image.png");
  });

  it("keep the browser tab's title and name the product on the card", () => {
    expect(title(meta)).toBe("BhayanakCast · your crew, your screens, one room");
    expect(tag(meta, "og:title")).toBe("Your crew. Your screens. One room.");
  });

  it("use the origin it is given, not a hard-coded host", () => {
    expect(tag(siteMeta("https://other.example"), "og:url")).toBe("https://other.example/");
    expect(everything(meta)).not.toContain("bhayanak.net");
  });
});

describe("a public live room's tags", () => {
  it("name the room, its host and how many are watching, and link its own card", () => {
    const meta = roomMeta(ORIGIN, room());
    expectFullEmbed(meta, `${ORIGIN}/room/r_public1`);
    expect(tag(meta, "og:title")).toBe("Friday ranked grind");
    expect(tag(meta, "og:description")).toBe(
      "Live now · hosted by nebula.wav · 7 watching · join on BhayanakCast",
    );
    expect(tag(meta, "og:image")).toBe(`${ORIGIN}/api/og/room/r_public1.png?v=0`);
    expect(title(meta)).toBe("Friday ranked grind — BhayanakCast");
  });

  it("version the card's URL by the newest thumbnail, so a new one isn't a cached image", () => {
    const meta = roomMeta(
      ORIGIN,
      room({
        streamers: [
          { id: "a", username: "a", image: null, thumbnailAt: "2026-10-03T10:00:00.000Z" },
          { id: "b", username: "b", image: null, thumbnailAt: "2026-10-03T10:03:00.000Z" },
          { id: "c", username: "c", image: null, thumbnailAt: null },
        ],
      }),
    );
    const newest = Date.parse("2026-10-03T10:03:00.000Z");
    expect(tag(meta, "og:image")).toBe(`${ORIGIN}${roomImagePath("r_public1", newest)}`);
  });

  it("leave out the host when the account is gone", () => {
    const meta = roomMeta(ORIGIN, room({ host: null, participantCount: 1 }));
    expect(tag(meta, "og:description")).toBe("Live now · 1 watching · join on BhayanakCast");
  });

  it("escape an id that isn't URL-safe", () => {
    const meta = roomMeta(ORIGIN, room({ id: "a b/c" }));
    expect(tag(meta, "og:url")).toBe(`${ORIGIN}/room/a%20b%2Fc`);
    expect(tag(meta, "og:image")).toContain("/api/og/room/a%20b%2Fc.png");
  });
});

describe("a private room's tags", () => {
  const privateRoom = room({
    id: "r_private1",
    name: SECRET_NAME,
    isPrivate: true,
    host: { id: "u2", username: SECRET_HOST, image: "https://cdn.discordapp.com/avatars/1/x.png" },
    participantCount: 3,
  });

  it("are the generic ones, even if a private room is handed to the public builder", () => {
    const meta = roomMeta(ORIGIN, privateRoom);
    expect(meta).toEqual(privateRoomMeta(ORIGIN));
    expectFullEmbed(meta, `${ORIGIN}/`);
    expect(tag(meta, "og:title")).toBe("A private room on BhayanakCast");
  });

  it("name nothing about the room: not its name, host, id, people or card image", () => {
    const text = everything(roomMeta(ORIGIN, privateRoom));
    for (const secret of [SECRET_NAME, SECRET_HOST, "r_private1", "api/og", "3 watching"]) {
      expect(text).not.toContain(secret);
    }
    expect(tag(roomMeta(ORIGIN, privateRoom), "og:image")).toBe(`${ORIGIN}${SITE_IMAGE_PATH}`);
  });
});

describe("an invite link's tags", () => {
  // The route builds them from the origin alone: no token and no room ever reach the builder.
  const meta = privateRoomMeta(ORIGIN);

  it("are generic, with the site image and the site as their URL", () => {
    expectFullEmbed(meta, `${ORIGIN}/`);
    expect(tag(meta, "og:title")).toBe("A private room on BhayanakCast");
    expect(tag(meta, "og:image")).toBe(`${ORIGIN}${SITE_IMAGE_PATH}`);
  });

  it("carry no token and no invite path", () => {
    const text = everything(meta);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("/join/");
  });
});

describe("the tags for a room link a visitor can't see", () => {
  const meta = unavailableRoomMeta(ORIGIN);

  it("are generic and say only that it ended or is private", () => {
    expectFullEmbed(meta, `${ORIGIN}/`);
    expect(tag(meta, "og:title")).toBe("This room isn't available");
    expect(tag(meta, "og:description")).toBe(
      "It has ended or is private. See what's live on BhayanakCast.",
    );
    expect(tag(meta, "og:image")).toBe(`${ORIGIN}${SITE_IMAGE_PATH}`);
  });
});

describe("a recap's tags", () => {
  const recap: Pick<Recap, "id" | "name" | "isPrivate" | "host" | "durationMinutes" | "people"> = {
    id: "r_past1",
    name: "Movie night",
    isPrivate: false,
    host: { id: "u1", username: "nebula.wav", image: null },
    durationMinutes: 95,
    people: [{}, {}, {}] as Recap["people"],
  };

  it("name the stream, host, people and length, with the site image", () => {
    const meta = recapMeta(ORIGIN, recap);
    expectFullEmbed(meta, `${ORIGIN}/past/r_past1`);
    expect(tag(meta, "og:title")).toBe("Movie night");
    expect(tag(meta, "og:description")).toBe(
      "Past stream · hosted by nebula.wav · 3 people · 1h 35m",
    );
    expect(tag(meta, "og:image")).toBe(`${ORIGIN}${SITE_IMAGE_PATH}`);
  });

  it("say '1 person' for one", () => {
    const meta = recapMeta(ORIGIN, { ...recap, people: [{}] as Recap["people"] });
    expect(tag(meta, "og:description")).toContain("· 1 person ·");
  });

  it("are generic for a private room's recap", () => {
    const meta = recapMeta(ORIGIN, { ...recap, name: SECRET_NAME, isPrivate: true });
    expect(meta).toEqual(privateRoomMeta(ORIGIN));
    expect(everything(meta)).not.toContain(SECRET_NAME);
  });
});

describe("a profile's tags", () => {
  const profile: Pick<Profile, "id" | "username" | "stats"> = {
    id: "u1",
    username: "nebula.wav",
    stats: {
      hoursStreamed: 12.34,
      hoursWatched: 40,
      roomsHosted: 1,
      roomsJoined: 9,
      peakViewers: 5,
    },
  };

  it("name the person and their public stats", () => {
    const meta = profileMeta(ORIGIN, profile);
    expectFullEmbed(meta, `${ORIGIN}/profile/u1`);
    expect(tag(meta, "og:title")).toBe("nebula.wav on BhayanakCast");
    expect(tag(meta, "og:description")).toBe("12.3h streamed · 40.0h watched · 1 room hosted");
    expect(tag(meta, "og:image")).toBe(`${ORIGIN}${SITE_IMAGE_PATH}`);
  });
});
