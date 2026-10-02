import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STUN_SERVERS } from "~/lib/ice";
import type { Db } from "../db/client.ts";
import { roomMembers, rooms, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { type Caller, type SignedInCaller, SignInRequiredError } from "./caller.ts";
import { FakeClock } from "./clock.ts";
import {
  cloudflareTurn,
  ICE_REPORT_RATE_LIMIT,
  IceService,
  mayEnterRoom,
  TURN_CREDENTIAL_TTL_S,
  TURN_REFRESH_MARGIN_S,
  type TurnProvider,
} from "./ice.ts";

const visitor: Caller = { user: null, role: "visitor" };
const asUser = (id: string): Caller => ({ user: { id, username: id, image: null }, role: "user" });

/** A TURN provider that mints numbered credentials, or fails while `failing`. */
function fakeTurn() {
  const turn = {
    minted: [] as number[],
    failing: false,
    async mint(ttlSeconds: number): Promise<RTCIceServer[]> {
      turn.minted.push(ttlSeconds);
      if (turn.failing) throw new Error("cloudflare down");
      return [
        { urls: ["turn:turn.example:3478"], username: `u${turn.minted.length}`, credential: "c" },
      ];
    },
  } satisfies TurnProvider & Record<string, unknown>;
  return turn;
}

/** Rooms "r1" and "r2" are open to everyone; nobody may enter anything else ("r3" is ended). */
function setup(
  turn: TurnProvider | null = fakeTurn(),
  mayEnter: (caller: SignedInCaller, roomId: string) => Promise<boolean> = async (_, roomId) =>
    roomId === "r1" || roomId === "r2",
) {
  const clock = new FakeClock();
  const lines: { line: string; error?: unknown }[] = [];
  const service = new IceService({
    turn,
    mayEnter,
    clock,
    log: (line, error) => lines.push({ line, error }),
  });
  return { clock, lines, service };
}

const username = (servers: RTCIceServer[]) => servers.find((s) => s.username)?.username;

describe("ICE servers", () => {
  it("are for signed-in callers only", async () => {
    const { service } = setup();
    await expect(service.serversFor(visitor, "r1")).rejects.toThrow(SignInRequiredError);
  });

  it("mint TURN credentials once per user and reuse them until near expiry", async () => {
    const turn = fakeTurn();
    const { clock, service } = setup(turn);
    const first = await service.serversFor(asUser("ana"), "r1");
    expect(turn.minted).toEqual([TURN_CREDENTIAL_TTL_S]);
    expect(username(first.iceServers)).toBe("u1");
    // Asked again just when a page should: with the refresh margin left.
    expect(first.refreshInSeconds).toBe(TURN_CREDENTIAL_TTL_S - TURN_REFRESH_MARGIN_S);

    clock.advance(60 * 60_000);
    const again = await service.serversFor(asUser("ana"), "r1");
    expect(username(again.iceServers)).toBe("u1");
    expect(again.refreshInSeconds).toBe(TURN_CREDENTIAL_TTL_S - TURN_REFRESH_MARGIN_S - 3_600);
    // Someone else gets their own.
    expect(username((await service.serversFor(asUser("bo"), "r1")).iceServers)).toBe("u2");

    clock.advance((first.refreshInSeconds - 3_600) * 1_000);
    expect(username((await service.serversFor(asUser("ana"), "r1")).iceServers)).toBe("u3");
    expect(turn.minted).toHaveLength(3);
  });

  it("share one mint between requests that arrive together", async () => {
    const turn = fakeTurn();
    const { service } = setup(turn);
    const both = await Promise.all([
      service.serversFor(asUser("ana"), "r1"),
      service.serversFor(asUser("ana"), "r1"),
    ]);
    expect(turn.minted).toHaveLength(1);
    expect(both.map((g) => username(g.iceServers))).toEqual(["u1", "u1"]);
  });

  it("fall back to STUN, logged, when minting fails, and try again next time", async () => {
    const turn = fakeTurn();
    turn.failing = true;
    const { lines, service } = setup(turn);
    expect(await service.serversFor(asUser("ana"), "r1")).toEqual({
      iceServers: STUN_SERVERS,
      refreshInSeconds: 60,
    });
    expect(lines).toEqual([
      {
        line: expect.stringContaining("minting TURN credentials failed"),
        error: expect.any(Error),
      },
    ]);
    turn.failing = false;
    expect(username((await service.serversFor(asUser("ana"), "r1")).iceServers)).toBe("u2");
  });

  it("are STUN only without a TURN key", async () => {
    const { service } = setup(null);
    expect((await service.serversFor(asUser("ana"), "r1")).iceServers).toEqual(STUN_SERVERS);
  });

  it("carry no TURN credentials for someone who can't enter the room, and mint nothing", async () => {
    const turn = fakeTurn();
    const { service } = setup(turn);
    // A room that isn't live (or isn't open to them) and one that never existed.
    for (const roomId of ["r3", "nope"]) {
      expect(await service.serversFor(asUser("ana"), roomId)).toEqual({
        iceServers: STUN_SERVERS,
        refreshInSeconds: 60,
      });
    }
    expect(turn.minted).toEqual([]);
  });

  it("ask the room's rule for the caller who asks, and hand TURN only to those it lets in", async () => {
    const turn = fakeTurn();
    const asked: string[] = [];
    const { service } = setup(turn, async (caller, roomId) => {
      asked.push(`${caller.user.id}:${roomId}`);
      return caller.user.id === "ana";
    });
    expect(username((await service.serversFor(asUser("ana"), "r1")).iceServers)).toBe("u1");
    expect((await service.serversFor(asUser("bo"), "r1")).iceServers).toEqual(STUN_SERVERS);
    expect(asked).toEqual(["ana:r1", "bo:r1"]);
    expect(turn.minted).toHaveLength(1);
  });

  it("keep one cached credential per user across rooms, and withhold it where they can't enter", async () => {
    const turn = fakeTurn();
    const { service } = setup(turn);
    expect(username((await service.serversFor(asUser("ana"), "r1")).iceServers)).toBe("u1");
    // Another room reuses the cached credentials: nothing is minted again.
    expect(username((await service.serversFor(asUser("ana"), "r2")).iceServers)).toBe("u1");
    // A cached credential isn't handed out for a room they can't enter.
    expect((await service.serversFor(asUser("ana"), "r3")).iceServers).toEqual(STUN_SERVERS);
    expect(turn.minted).toHaveLength(1);
  });

  it("are for signed-in callers before the room is even looked at", async () => {
    const asked: string[] = [];
    const { service } = setup(fakeTurn(), async (_, roomId) => {
      asked.push(roomId);
      return true;
    });
    await expect(service.serversFor(visitor, "r1")).rejects.toThrow(SignInRequiredError);
    expect(asked).toEqual([]);
  });
});

describe("mayEnterRoom", () => {
  let db: Db;
  let close: () => Promise<void>;
  const T0 = new Date("2026-09-01T12:00:00Z");
  const admin: Caller = { user: { id: "admin", username: "admin", image: null }, role: "admin" };
  const signedIn = (id: string) => asUser(id) as SignedInCaller;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await db.insert(user).values(
      ["host", "ana", "member", "kicked", "admin"].map((id) => ({
        id,
        name: id,
        email: `${id}@discord.invalid`,
        discordUsername: `${id}.discord`,
        role: id === "admin" ? "admin" : "user",
      })),
    );
    await db.insert(rooms).values([
      { id: "pub", name: "public", hostUserId: "host", createdBy: "host", createdAt: T0 },
      {
        id: "priv",
        name: "private",
        hostUserId: "host",
        createdBy: "host",
        createdAt: T0,
        isPrivate: true,
      },
      {
        id: "old",
        name: "ended",
        hostUserId: "host",
        createdBy: "host",
        createdAt: T0,
        endedAt: T0,
      },
    ]);
    await db.insert(roomMembers).values([
      { roomId: "priv", userId: "member", approved: true },
      { roomId: "pub", userId: "kicked", kicked: true },
      { roomId: "priv", userId: "kicked", approved: true, kicked: true },
    ]);
  });

  afterEach(async () => {
    await close();
  });

  it("lets a signed-in user into a live public room, and the host and approved members into a private one", async () => {
    expect(await mayEnterRoom(db, signedIn("ana"), "pub")).toBe(true);
    expect(await mayEnterRoom(db, signedIn("host"), "priv")).toBe(true);
    expect(await mayEnterRoom(db, signedIn("member"), "priv")).toBe(true);
    expect(await mayEnterRoom(db, admin as SignedInCaller, "priv")).toBe(true);
  });

  it("refuses a private room they weren't approved into, an ended room and an unknown one", async () => {
    expect(await mayEnterRoom(db, signedIn("ana"), "priv")).toBe(false);
    expect(await mayEnterRoom(db, signedIn("host"), "old")).toBe(false);
    expect(await mayEnterRoom(db, signedIn("host"), "nope")).toBe(false);
  });

  it("refuses someone kicked from the room", async () => {
    expect(await mayEnterRoom(db, signedIn("kicked"), "pub")).toBe(false);
    expect(await mayEnterRoom(db, signedIn("kicked"), "priv")).toBe(false);
  });
});

describe("Cloudflare TURN", () => {
  it("asks generate-ice-servers with the key and drops the port 53 URLs browsers block", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const turn = cloudflareTurn({
      keyId: "key id",
      apiToken: "secret-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json(
          {
            iceServers: [
              { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
              {
                urls: [
                  "turn:turn.cloudflare.com:3478?transport=udp",
                  "turn:turn.cloudflare.com:53?transport=udp",
                  "turn:turn.cloudflare.com:3478?transport=tcp",
                  "turns:turn.cloudflare.com:443?transport=tcp",
                ],
                username: "user",
                credential: "pass",
              },
              { urls: "turn:turn.cloudflare.com:53" },
            ],
          },
          { status: 201 },
        );
      },
    });
    expect(await turn.mint(600)).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turn:turn.cloudflare.com:3478?transport=tcp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "user",
        credential: "pass",
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key%20id/credentials/generate-ice-servers",
    );
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer secret-token" },
      body: JSON.stringify({ ttl: 600 }),
    });
  });

  it("fails on an error status or an unexpected body", async () => {
    const answering = (response: Response) =>
      cloudflareTurn({ keyId: "k", apiToken: "t", fetch: async () => response });
    await expect(answering(new Response("nope", { status: 401 })).mint(60)).rejects.toThrow(/401/);
    await expect(answering(Response.json({ servers: [] })).mint(60)).rejects.toThrow();
  });
});

describe("ICE reports", () => {
  const report = {
    outcome: "relayed" as const,
    path: {
      selected: {
        local: { type: "relay" as const, protocol: "udp" as const, relayProtocol: "tls" as const },
        remote: { type: "srflx" as const, protocol: "udp" as const },
      },
      local: [{ type: "host" as const, protocol: "udp" as const }],
      remote: [],
    },
  };

  it("are logged without who sent them, for signed-in callers only", () => {
    const { lines, service } = setup();
    expect(() => service.report(visitor, report)).toThrow(SignInRequiredError);
    expect(service.report(asUser("ana"), report)).toBe(true);
    expect(lines).toEqual([{ line: `[ice] ${JSON.stringify(report)}` }]);
    expect(lines[0]?.line).not.toContain("ana");
  });

  it("are dropped over the rate limit, per user, until the window passes", () => {
    const { clock, lines, service } = setup();
    for (let i = 0; i < ICE_REPORT_RATE_LIMIT.reports; i++) service.report(asUser("ana"), report);
    expect(service.report(asUser("ana"), report)).toBe(false);
    expect(service.report(asUser("bo"), report)).toBe(true);
    clock.advance(ICE_REPORT_RATE_LIMIT.windowMs);
    expect(service.report(asUser("ana"), report)).toBe(true);
    expect(lines).toHaveLength(ICE_REPORT_RATE_LIMIT.reports + 2);
  });
});
