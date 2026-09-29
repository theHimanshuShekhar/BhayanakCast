import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { user, userCotime, userStats } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import type { Caller } from "./caller.ts";
import { getProfile, searchUsers } from "./profiles.ts";

let db: Db;
let close: () => Promise<void>;

const visitor: Caller = { user: null, role: "visitor" };
const JOINED = new Date("2024-03-05T12:00:00Z");
const AVATAR = "https://cdn.discordapp.com/avatars/1234/abcd.png";

async function addUser(
  id: string,
  discordUsername: string | null,
  name = `${id} display`,
  image: string | null = null,
) {
  await db.insert(user).values({
    id,
    name,
    email: `${id}@discord.invalid`,
    discordUsername,
    image,
    createdAt: JOINED,
  });
}

/** Co-time stored the way the roll-up stores it: once per pair, userA < userB. */
async function addCotime(a: string, b: string, secondsTogether: number) {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  await db.insert(userCotime).values({ userA, userB, secondsTogether });
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe("getProfile", () => {
  it("returns username, join date and stats converted to hours", async () => {
    await addUser("u1", "kodama_jpg", "kodama", AVATAR);
    await db.insert(userStats).values({
      userId: "u1",
      secondsStreamed: 5400,
      secondsWatched: 36_000,
      roomsHosted: 3,
      roomsJoined: 7,
      peakViewers: 9,
    });

    expect(await getProfile(db, visitor, "u1")).toEqual({
      id: "u1",
      username: "kodama_jpg",
      image: AVATAR,
      displayName: "kodama",
      joinedAt: JOINED.toISOString(),
      stats: {
        hoursStreamed: 1.5,
        hoursWatched: 10,
        roomsHosted: 3,
        roomsJoined: 7,
        peakViewers: 9,
      },
      coUsers: [],
    });
  });

  it("shows zeros for a new user with no stats row", async () => {
    await addUser("new", "fresh.face");
    expect((await getProfile(db, visitor, "new"))?.stats).toEqual({
      hoursStreamed: 0,
      hoursWatched: 0,
      roomsHosted: 0,
      roomsJoined: 0,
      peakViewers: 0,
    });
  });

  it("falls back to the display name without a Discord username", async () => {
    await addUser("u1", null, "just a name");
    expect((await getProfile(db, visitor, "u1"))?.username).toBe("just a name");
  });

  it("returns null for an unknown id", async () => {
    expect(await getProfile(db, visitor, "no-such-user")).toBeNull();
  });

  it("lists the top 5 co-users by time together from either side of the pair", async () => {
    // "m" sorts between the others, so it is userB of some pairs and userA of others.
    for (const id of ["a", "b", "c", "m", "x", "y", "z"]) {
      await addUser(id, `${id}.discord`, undefined, id === "b" ? AVATAR : null);
    }
    await addCotime("m", "a", 100);
    await addCotime("m", "b", 600);
    await addCotime("m", "c", 300);
    await addCotime("m", "x", 500);
    await addCotime("m", "y", 300);
    await addCotime("m", "z", 50);
    // Not involving "m": never listed.
    await addCotime("a", "b", 10_000);

    const profile = await getProfile(db, visitor, "m");
    expect(profile?.coUsers).toEqual([
      { id: "b", username: "b.discord", image: AVATAR, secondsTogether: 600 },
      { id: "x", username: "x.discord", image: null, secondsTogether: 500 },
      // Ties by id.
      { id: "c", username: "c.discord", image: null, secondsTogether: 300 },
      { id: "y", username: "y.discord", image: null, secondsTogether: 300 },
      { id: "a", username: "a.discord", image: null, secondsTogether: 100 },
    ]);
    // Co-time is symmetric: the other side sees the same pair.
    expect((await getProfile(db, visitor, "z"))?.coUsers).toEqual([
      { id: "m", username: "m.discord", image: null, secondsTogether: 50 },
    ]);
  });

  it("skips pairs with no time together", async () => {
    await addUser("a", "a.discord");
    await addUser("b", "b.discord");
    await addCotime("a", "b", 0);
    expect((await getProfile(db, visitor, "a"))?.coUsers).toEqual([]);
  });
});

describe("searchUsers", () => {
  const names = async (query: string) =>
    (await searchUsers(db, visitor, { query })).map((u) => u.username);

  beforeEach(async () => {
    await addUser("u1", "kodama_jpg");
    await addUser("u2", "nelly.jpg");
    await addUser("u3", "bitreverb", undefined, AVATAR);
    await addUser("u4", "jpg");
    await addUser("u5", null, "no discord jpg");
  });

  it("matches a case-insensitive substring of the Discord username", async () => {
    expect(await names("REVERB")).toEqual(["bitreverb"]);
    // Prefix matches first, then shorter names, then A-Z.
    expect(await names("jpg")).toEqual(["jpg", "nelly.jpg", "kodama_jpg", "no discord jpg"]);
  });

  it("returns ids and stats in hours for the result cards", async () => {
    await db
      .insert(userStats)
      .values({ userId: "u3", secondsStreamed: 7200, secondsWatched: 1800 });
    expect(await searchUsers(db, visitor, { query: "bitreverb" })).toEqual([
      {
        id: "u3",
        username: "bitreverb",
        image: AVATAR,
        displayName: "u3 display",
        stats: { hoursStreamed: 2, hoursWatched: 0.5 },
      },
    ]);
  });

  it("treats LIKE wildcards literally", async () => {
    expect(await names("%")).toEqual([]);
    expect(await names("a_j")).toEqual(["kodama_jpg"]);
  });

  it("returns nothing when no one matches", async () => {
    expect(await names("zzz")).toEqual([]);
  });

  it("limits the result count", async () => {
    for (let i = 0; i < 20; i++) await addUser(`many${i}`, `crowd${i}`);
    expect(await names("crowd")).toHaveLength(8);
  });

  it("rejects an empty or overlong query", async () => {
    await expect(searchUsers(db, visitor, { query: "   " })).rejects.toThrow();
    await expect(searchUsers(db, visitor, { query: "x".repeat(65) })).rejects.toThrow();
  });
});
