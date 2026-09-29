import { describe, expect, it } from "vitest";
import { AdminRequiredError, type Caller } from "./caller.ts";
import { FakeClock } from "./clock.ts";
import {
  cloudflareTurnAnalytics,
  TURN_USAGE_CACHE_MS,
  type TurnAnalytics,
  type TurnEgressDay,
  TurnUsageService,
} from "./turn-usage.ts";

const visitor: Caller = { user: null, role: "visitor" };
const plainUser: Caller = { user: { id: "a", username: "a", image: null }, role: "user" };
const admin: Caller = { user: { id: "admin", username: "admin", image: null }, role: "admin" };

const GB = 1_000_000_000;

/** A fake Cloudflare: answers `rows` (or fails) and counts calls. */
function fakeAnalytics(rows: TurnEgressDay[] = []) {
  const fake = {
    calls: [] as [string, string][],
    fail: false,
    rows,
    async egressByDay(from: string, to: string): Promise<TurnEgressDay[]> {
      fake.calls.push([from, to]);
      if (fake.fail) throw new Error("boom");
      return fake.rows;
    },
  };
  return fake;
}

function setup(analytics: TurnAnalytics | null, start = "2026-09-03T12:00:00Z") {
  const clock = new FakeClock(start);
  const logs: string[] = [];
  const service = new TurnUsageService({ analytics, clock, log: (line) => logs.push(line) });
  return { clock, logs, service };
}

describe("TurnUsageService", () => {
  it("refuses visitors and users, and answers admins", async () => {
    const { service } = setup(fakeAnalytics());
    await expect(service.usage(visitor)).rejects.toBeInstanceOf(AdminRequiredError);
    await expect(service.usage(plainUser)).rejects.toBeInstanceOf(AdminRequiredError);
    await expect(service.usage({ user: null, role: "admin" })).rejects.toBeInstanceOf(
      AdminRequiredError,
    );
    await expect(service.usage(admin)).resolves.toMatchObject({ status: "ok" });
  });

  it("refuses non-admins before touching Cloudflare", async () => {
    const analytics = fakeAnalytics();
    const { service } = setup(analytics);
    await expect(service.usage(plainUser)).rejects.toBeInstanceOf(AdminRequiredError);
    expect(analytics.calls).toEqual([]);
  });

  it("says not configured without analytics", async () => {
    const { service } = setup(null);
    await expect(service.usage(admin)).resolves.toEqual({ status: "not-configured" });
  });

  it("asks for the current month up to today and sums each day (every key's rows), filling gaps with zeros", async () => {
    const analytics = fakeAnalytics([
      { day: "2026-09-01", bytes: 10 * GB },
      { day: "2026-09-01", bytes: 5 * GB },
      { day: "2026-09-03", bytes: 20 * GB },
      // Outside the month: ignored.
      { day: "2026-08-31", bytes: 999 * GB },
    ]);
    const { service } = setup(analytics);
    const usage = await service.usage(admin);
    expect(analytics.calls).toEqual([["2026-09-01", "2026-09-03"]]);
    expect(usage).toMatchObject({
      status: "ok",
      month: "2026-09",
      totalGb: 35,
      warning: false,
      daily: [
        { day: "2026-09-01", gb: 15 },
        { day: "2026-09-02", gb: 0 },
        { day: "2026-09-03", gb: 20 },
      ],
    });
    expect(usage.status === "ok" && usage.percent).toBeCloseTo(3.5);
  });

  it("raises the warning at 80% of 1,000 GB and not below", async () => {
    const below = setup(fakeAnalytics([{ day: "2026-09-02", bytes: 799 * GB }]));
    await expect(below.service.usage(admin)).resolves.toMatchObject({ warning: false });
    const at = setup(fakeAnalytics([{ day: "2026-09-02", bytes: 800 * GB }]));
    await expect(at.service.usage(admin)).resolves.toMatchObject({ percent: 80, warning: true });
    const over = setup(fakeAnalytics([{ day: "2026-09-02", bytes: 1_200 * GB }]));
    await expect(over.service.usage(admin)).resolves.toMatchObject({ percent: 120, warning: true });
  });

  it("reports unavailable when Cloudflare fails, logs it, and tries again next time", async () => {
    const analytics = fakeAnalytics([{ day: "2026-09-01", bytes: GB }]);
    analytics.fail = true;
    const { service, logs } = setup(analytics);
    await expect(service.usage(admin)).resolves.toEqual({ status: "unavailable" });
    expect(logs).toEqual(["[turn-usage] Cloudflare analytics failed"]);
    analytics.fail = false;
    await expect(service.usage(admin)).resolves.toMatchObject({ status: "ok", totalGb: 1 });
    expect(analytics.calls).toHaveLength(2);
  });

  it("caches for 15 minutes, then asks again", async () => {
    const analytics = fakeAnalytics([{ day: "2026-09-01", bytes: GB }]);
    const { service, clock } = setup(analytics);
    await service.usage(admin);
    clock.advance(TURN_USAGE_CACHE_MS - 1);
    analytics.rows = [{ day: "2026-09-01", bytes: 2 * GB }];
    await expect(service.usage(admin)).resolves.toMatchObject({ totalGb: 1 });
    expect(analytics.calls).toHaveLength(1);
    clock.advance(1);
    await expect(service.usage(admin)).resolves.toMatchObject({ totalGb: 2 });
    expect(analytics.calls).toHaveLength(2);
  });

  it("asks again on the 1st of a new month even within 15 minutes of the last answer", async () => {
    const analytics = fakeAnalytics([{ day: "2026-09-30", bytes: 50 * GB }]);
    const { service, clock } = setup(analytics, "2026-09-30T23:55:00Z");
    await expect(service.usage(admin)).resolves.toMatchObject({ month: "2026-09", totalGb: 50 });
    analytics.rows = [{ day: "2026-10-01", bytes: GB }];
    clock.advance(10 * 60_000);
    await expect(service.usage(admin)).resolves.toMatchObject({ month: "2026-10", totalGb: 1 });
    expect(analytics.calls).toEqual([
      ["2026-09-01", "2026-09-30"],
      ["2026-10-01", "2026-10-01"],
    ]);
  });

  it("shares one Cloudflare call between concurrent requests", async () => {
    const analytics = fakeAnalytics();
    const { service } = setup(analytics);
    await Promise.all([service.usage(admin), service.usage(admin)]);
    expect(analytics.calls).toHaveLength(1);
  });
});

describe("cloudflareTurnAnalytics", () => {
  const options = { accountId: "acct", apiToken: "secret-token" };
  const answer = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  const group = (datetimeHour: string, egressBytes: number) => ({
    dimensions: { datetimeHour },
    sum: { egressBytes },
  });

  it("sends the token as a bearer header, and reads every hour of the account as its day", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const client = cloudflareTurnAnalytics({
      ...options,
      fetch: (async (url, init) => {
        request = { url: String(url), init };
        return new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [
                  {
                    callsTurnUsageAdaptiveGroups: [
                      group("2026-09-02T10:00:00Z", 5),
                      group("2026-09-02T11:00:00Z", 7),
                    ],
                  },
                ],
              },
            },
          }),
        );
      }) as typeof fetch,
    });
    await expect(client.egressByDay("2026-09-01", "2026-09-03")).resolves.toEqual([
      { day: "2026-09-02", bytes: 5 },
      { day: "2026-09-02", bytes: 7 },
    ]);
    expect(request?.url).toBe("https://api.cloudflare.com/client/v4/graphql");
    expect(new Headers(request?.init?.headers).get("authorization")).toBe("Bearer secret-token");
    const body = JSON.parse(String(request?.init?.body));
    expect(body.variables).toEqual({ accountId: "acct", from: "2026-09-01", to: "2026-09-03" });
    // Account-wide: no per-key dimension or filter.
    expect(String(body.query)).not.toContain("keyId");
    // The token travels only in the header.
    expect(JSON.stringify(body)).not.toContain("secret-token");
  });

  it("throws, without the token, on HTTP errors and GraphQL errors", async () => {
    const http = cloudflareTurnAnalytics({ ...options, fetch: answer({}, 403) });
    await expect(http.egressByDay("2026-09-01", "2026-09-03")).rejects.toThrow(/403/);
    const graphql = cloudflareTurnAnalytics({
      ...options,
      fetch: answer({ data: null, errors: [{ message: "not authorized" }] }),
    });
    const error = await graphql.egressByDay("2026-09-01", "2026-09-03").catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("not authorized");
    expect((error as Error).message).not.toContain("secret-token");
  });

  it("throws on an unexpected response shape", async () => {
    const client = cloudflareTurnAnalytics({ ...options, fetch: answer({ data: { viewer: 1 } }) });
    await expect(client.egressByDay("2026-09-01", "2026-09-03")).rejects.toThrow();
  });
});
