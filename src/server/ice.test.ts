import { describe, expect, it } from "vitest";
import { STUN_SERVERS } from "~/lib/ice";
import { type Caller, SignInRequiredError } from "./caller.ts";
import { FakeClock } from "./clock.ts";
import {
  cloudflareTurn,
  ICE_REPORT_RATE_LIMIT,
  IceService,
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

function setup(turn: TurnProvider | null = fakeTurn()) {
  const clock = new FakeClock();
  const lines: { line: string; error?: unknown }[] = [];
  const service = new IceService({
    turn,
    clock,
    log: (line, error) => lines.push({ line, error }),
  });
  return { clock, lines, service };
}

const username = (servers: RTCIceServer[]) => servers.find((s) => s.username)?.username;

describe("ICE servers", () => {
  it("are for signed-in callers only", async () => {
    const { service } = setup();
    await expect(service.serversFor(visitor)).rejects.toThrow(SignInRequiredError);
  });

  it("mint TURN credentials once per user and reuse them until near expiry", async () => {
    const turn = fakeTurn();
    const { clock, service } = setup(turn);
    const first = await service.serversFor(asUser("ana"));
    expect(turn.minted).toEqual([TURN_CREDENTIAL_TTL_S]);
    expect(username(first.iceServers)).toBe("u1");
    // Asked again just when a page should: with the refresh margin left.
    expect(first.refreshInSeconds).toBe(TURN_CREDENTIAL_TTL_S - TURN_REFRESH_MARGIN_S);

    clock.advance(60 * 60_000);
    const again = await service.serversFor(asUser("ana"));
    expect(username(again.iceServers)).toBe("u1");
    expect(again.refreshInSeconds).toBe(TURN_CREDENTIAL_TTL_S - TURN_REFRESH_MARGIN_S - 3_600);
    // Someone else gets their own.
    expect(username((await service.serversFor(asUser("bo"))).iceServers)).toBe("u2");

    clock.advance((first.refreshInSeconds - 3_600) * 1_000);
    expect(username((await service.serversFor(asUser("ana"))).iceServers)).toBe("u3");
    expect(turn.minted).toHaveLength(3);
  });

  it("share one mint between requests that arrive together", async () => {
    const turn = fakeTurn();
    const { service } = setup(turn);
    const both = await Promise.all([
      service.serversFor(asUser("ana")),
      service.serversFor(asUser("ana")),
    ]);
    expect(turn.minted).toHaveLength(1);
    expect(both.map((g) => username(g.iceServers))).toEqual(["u1", "u1"]);
  });

  it("fall back to STUN, logged, when minting fails, and try again next time", async () => {
    const turn = fakeTurn();
    turn.failing = true;
    const { lines, service } = setup(turn);
    expect(await service.serversFor(asUser("ana"))).toEqual({
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
    expect(username((await service.serversFor(asUser("ana"))).iceServers)).toBe("u2");
  });

  it("are STUN only without a TURN key", async () => {
    const { service } = setup(null);
    expect((await service.serversFor(asUser("ana"))).iceServers).toEqual(STUN_SERVERS);
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
