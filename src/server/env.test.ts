import { describe, expect, it } from "vitest";
import { isTestSignInEnabled, parseEnv } from "./env.ts";

const productionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:secret@db:5432/app",
  BETTER_AUTH_SECRET: "prod-secret-prod-secret-prod-secret-0000",
  BETTER_AUTH_URL: "https://cast.bhayanak.net",
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
  TRUSTED_PROXY_IPS: "10.1.1.5",
};

describe("empty values", () => {
  it("count as unset, as docker compose passes unset variables through as empty", () => {
    const parsed = parseEnv({
      ...productionEnv,
      E2E_AUTH: "",
      ADMIN_DISCORD_IDS: "",
      CLOUDFLARE_TURN_KEY_ID: "",
      REALTIME_ANONYMOUS_SOCKETS_PER_IP: "",
      REALTIME_SOCKETS_PER_USER: "",
      REALTIME_EMPTY_ROOM_TIMEOUT_MS: " ",
    });
    expect(parsed).toMatchObject({
      ADMIN_DISCORD_IDS: [],
      REALTIME_ANONYMOUS_SOCKETS_PER_IP: 20,
      REALTIME_SOCKETS_PER_USER: 10,
    });
    expect(parsed.E2E_AUTH).toBeUndefined();
    expect(parsed.CLOUDFLARE_TURN_KEY_ID).toBeUndefined();
    expect(parsed.REALTIME_EMPTY_ROOM_TIMEOUT_MS).toBeUndefined();
  });

  it("still fail production startup for required variables, listing each", () => {
    expect(() =>
      parseEnv({ ...productionEnv, BETTER_AUTH_SECRET: "", DISCORD_CLIENT_ID: "" }),
    ).toThrow(/BETTER_AUTH_SECRET[\s\S]*DISCORD_CLIENT_ID/);
  });
});

describe("trusted proxies", () => {
  it("parses a comma-separated list of IPs and CIDR ranges", () => {
    expect(
      parseEnv({ ...productionEnv, TRUSTED_PROXY_IPS: " 10.1.1.5, 172.18.0.0/16 ,::1" })
        .TRUSTED_PROXY_IPS,
    ).toEqual(["10.1.1.5", "172.18.0.0/16", "::1"]);
  });

  it("fails startup on an entry that isn't an IP or range", () => {
    expect(() => parseEnv({ ...productionEnv, TRUSTED_PROXY_IPS: "10.1.1.5,cloudflared" })).toThrow(
      /TRUSTED_PROXY_IPS/,
    );
    expect(() => parseEnv({ TRUSTED_PROXY_IPS: "10.1.1.0/40" })).toThrow(/TRUSTED_PROXY_IPS/);
  });

  it("is required in production and optional elsewhere", () => {
    const { TRUSTED_PROXY_IPS: _, ...withoutProxies } = productionEnv;
    expect(() => parseEnv(withoutProxies)).toThrow(/TRUSTED_PROXY_IPS: is required in production/);
    expect(() => parseEnv({ ...productionEnv, TRUSTED_PROXY_IPS: " , " })).toThrow(
      /TRUSTED_PROXY_IPS/,
    );
    expect(parseEnv({}).TRUSTED_PROXY_IPS).toEqual([]);
  });
});

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
