import { describe, expect, it } from "vitest";
import { isTestSignInEnabled, parseEnv } from "./env.ts";

const productionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:secret@db:5432/app",
  BETTER_AUTH_SECRET: "prod-secret-prod-secret-prod-secret-0000",
  BETTER_AUTH_URL: "https://cast.bhayanak.net",
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
};

describe("test-only sign-in flag", () => {
  it("fails production startup when E2E_AUTH is set", () => {
    expect(() => parseEnv(productionEnv)).not.toThrow();
    expect(() => parseEnv({ ...productionEnv, E2E_AUTH: "1" })).toThrow(/E2E_AUTH/);
  });

  it("is enabled only under tests or with E2E_AUTH=1, never in production", () => {
    expect(isTestSignInEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(isTestSignInEnabled({ NODE_ENV: "development", E2E_AUTH: "1" })).toBe(true);
    expect(isTestSignInEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isTestSignInEnabled({ NODE_ENV: "production", E2E_AUTH: "1" })).toBe(false);
  });
});
