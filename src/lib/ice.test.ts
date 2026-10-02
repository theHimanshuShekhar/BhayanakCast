import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasTurn,
  ICE_SERVERS_RETRY_MS,
  type IceServersGrant,
  icePathOf,
  isRelayed,
  keepIceServersFresh,
  STUN_SERVERS,
} from "./ice";

const report = (...stats: Record<string, unknown>[]) =>
  new Map(stats.map((s) => [s.id as string, s])) as unknown as RTCStatsReport;

describe("hasTurn", () => {
  it("tells TURN servers (turn: and turns:, one URL or several) from STUN alone", () => {
    expect(hasTurn(STUN_SERVERS)).toBe(false);
    expect(hasTurn([])).toBe(false);
    expect(hasTurn([{ urls: "turn:turn.example:3478" }])).toBe(true);
    expect(hasTurn([{ urls: ["stun:s.example", "turns:turn.example:443?transport=tcp"] }])).toBe(
      true,
    );
  });
});

describe("icePathOf", () => {
  it("takes Firefox's selected pair (no transport stats) and keeps no addresses", () => {
    const path = icePathOf(
      report(
        { id: "p1", type: "candidate-pair", localCandidateId: "a", remoteCandidateId: "b" },
        {
          id: "p2",
          type: "candidate-pair",
          localCandidateId: "c",
          remoteCandidateId: "b",
          selected: true,
        },
        { id: "a", type: "local-candidate", candidateType: "host", protocol: "udp", address: "x" },
        { id: "b", type: "remote-candidate", candidateType: "host", protocol: "UDP", address: "y" },
        { id: "c", type: "local-candidate", candidateType: "host", protocol: "tcp", address: "z" },
        // Unknown shapes are left out rather than reported.
        { id: "d", type: "local-candidate", candidateType: "weird", protocol: "udp" },
      ),
    );
    expect(path).toEqual({
      selected: {
        local: { type: "host", protocol: "tcp" },
        remote: { type: "host", protocol: "udp" },
      },
      local: [
        { type: "host", protocol: "udp" },
        { type: "host", protocol: "tcp" },
      ],
      remote: [{ type: "host", protocol: "udp" }],
    });
    expect(isRelayed(path)).toBe(false);
  });

  it("has no selected pair before (or without) connecting", () => {
    const path = icePathOf(
      report(
        { id: "p", type: "candidate-pair", localCandidateId: "a", remoteCandidateId: "b" },
        { id: "a", type: "local-candidate", candidateType: "relay", protocol: "udp" },
      ),
    );
    expect(path).toEqual({ local: [{ type: "relay", protocol: "udp" }], remote: [] });
    expect(isRelayed(path)).toBe(false);
  });
});

describe("keepIceServersFresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const turn = (n: number): RTCIceServer[] => [{ urls: "turn:t", username: `u${n}` }];

  it("asks again when the grant says, until stopped", async () => {
    vi.useFakeTimers();
    let asked = 0;
    const received: RTCIceServer[][] = [];
    const stop = keepIceServersFresh(
      async (): Promise<IceServersGrant> => {
        asked++;
        return { iceServers: turn(asked), refreshInSeconds: 100 };
      },
      (servers) => received.push(servers),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toEqual([turn(1)]);
    await vi.advanceTimersByTimeAsync(99_999);
    expect(asked).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(received).toEqual([turn(1), turn(2)]);
    stop();
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(asked).toBe(2);
  });

  it("falls back to STUN when the first ask fails, keeps what it has on later failures, and retries", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const answers: (IceServersGrant | Error)[] = [
      new Error("offline"),
      { iceServers: turn(1), refreshInSeconds: 10 },
      new Error("offline"),
      { iceServers: turn(2), refreshInSeconds: 10 },
    ];
    const received: RTCIceServer[][] = [];
    const stop = keepIceServersFresh(
      async () => {
        const answer = answers.shift();
        if (!answer || answer instanceof Error) throw answer;
        return answer;
      },
      (servers) => received.push(servers),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toEqual([STUN_SERVERS]);
    await vi.advanceTimersByTimeAsync(ICE_SERVERS_RETRY_MS);
    expect(received).toEqual([STUN_SERVERS, turn(1)]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(received).toEqual([STUN_SERVERS, turn(1)]);
    await vi.advanceTimersByTimeAsync(ICE_SERVERS_RETRY_MS);
    expect(received).toEqual([STUN_SERVERS, turn(1), turn(2)]);
    stop();
    vi.restoreAllMocks();
  });
});
