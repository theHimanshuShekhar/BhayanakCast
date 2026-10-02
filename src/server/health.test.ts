import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { createTestDb } from "../db/test-db.ts";
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
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is unhealthy, without leaking the error, when the query fails", async () => {
    const response = await healthResponse(
      brokenDb(() => Promise.reject(new Error("password authentication failed"))),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"ok":false}');
  });

  it("is unhealthy when the database doesn't answer within the timeout", async () => {
    const hung = brokenDb(() => new Promise(() => {}));
    expect(await databaseReachable(hung, 20)).toBe(false);
    expect((await healthResponse(hung, 20)).status).toBe(503);
  });
});
