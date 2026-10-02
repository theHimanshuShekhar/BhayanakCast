import { describe, expect, it } from "vitest";
import { databaseUrlProblem } from "./database-url.ts";

const compose = (password: string) => `postgres://bhayanakcast:${password}@db:5432/bhayanakcast`;

describe("databaseUrlProblem", () => {
  it("accepts what compose builds from a hex password", () => {
    expect(databaseUrlProblem(compose("0123456789abcdef".repeat(3)))).toBeUndefined();
    expect(databaseUrlProblem("postgresql://app:secret@localhost:5432/app")).toBeUndefined();
  });

  it("accepts percent-encoded special characters", () => {
    expect(databaseUrlProblem(compose(encodeURIComponent("p@ss/w#rd:1?")))).toBeUndefined();
  });

  it.each(["pa/ss", "pa#ss", "pa?ss", "12/ss", "12#ss", "100%"])(
    "refuses a raw %s in the password",
    (password) => {
      expect(databaseUrlProblem(compose(password))).toMatch(/percent-encode/);
    },
  );

  it("refuses non-Postgres URLs and a missing database name", () => {
    expect(databaseUrlProblem("not a url")).toMatch(/postgres:\/\//);
    expect(databaseUrlProblem("http://db:5432/app")).toMatch(/postgres:\/\//);
    expect(databaseUrlProblem("postgres://app:secret@db:5432")).toMatch(/database name/);
  });
});
