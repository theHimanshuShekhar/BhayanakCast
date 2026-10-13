import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { createTestDb } from "../db/test-db.ts";
import { shortCommit, startedAt } from "./build-info.ts";
import { databaseReachable, healthResponse } from "./health.ts";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

/** A database whose queries fail, or never answer. */
const brokenDb = (execute: () => Promise<unknown>) => ({ execute }) as unknown as Db;

describe("GET /api/health", () => {
  it("is healthy while the database answers", async () => {
    expect(await databaseReachable(db)).toBe(true);
    const response = await healthResponse(db);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      commit: shortCommit(),
      startedAt: startedAt(),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("names the running commit in 7 characters (or unknown) and when the server started", async () => {
    const body = (await (await healthResponse(db)).json()) as {
      commit: string;
      startedAt: string;
    };
    expect(body.commit).toMatch(/^(?:[0-9a-f]{7}|unknown)$/);
    expect(new Date(body.startedAt).toISOString()).toBe(body.startedAt);
  });

  it("is unhealthy, without leaking the error, when the query fails", async () => {
    const response = await healthResponse(
      brokenDb(() => Promise.reject(new Error("password authentication failed"))),
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      ok: false,
      commit: shortCommit(),
      startedAt: startedAt(),
    });
    expect(text).not.toContain("password");
  });

  it("is unhealthy when the database doesn't answer within the timeout", async () => {
    const hung = brokenDb(() => new Promise(() => {}));
    expect(await databaseReachable(hung, 20)).toBe(false);
    expect((await healthResponse(hung, 20)).status).toBe(503);
  });
});
