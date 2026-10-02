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
      REALTIME_EMPTY_ROOM_TIMEOUT_MS: " ",
    });
    expect(parsed).toMatchObject({ ADMIN_DISCORD_IDS: [], REALTIME_ANONYMOUS_SOCKETS_PER_IP: 20 });
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

describe("DATABASE_URL", () => {
  it("fails startup on a password that breaks the URL compose builds", () => {
    const withPassword = (password: string) =>
      parseEnv({ ...productionEnv, DATABASE_URL: `postgres://app:${password}@db:5432/app` });
    expect(() => withPassword("pa/ss")).toThrow(/DATABASE_URL: .*URL-safe password/);
    expect(() => withPassword("pa#ss")).toThrow(/DATABASE_URL/);
    expect(withPassword("0123abcd").DATABASE_URL).toContain("0123abcd");
    expect(withPassword(encodeURIComponent("pa/ss#1")).DATABASE_URL).toBeTruthy();
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
    expect(() => parseEnv({ NODE_ENV: "development", TRUSTED_PROXY_IPS: "10.1.1.0/40" })).toThrow(
      /TRUSTED_PROXY_IPS/,
    );
  });

  it("is required in production and optional elsewhere", () => {
    const { TRUSTED_PROXY_IPS: _, ...withoutProxies } = productionEnv;
    expect(() => parseEnv(withoutProxies)).toThrow(/TRUSTED_PROXY_IPS: is required in production/);
    expect(() => parseEnv({ ...productionEnv, TRUSTED_PROXY_IPS: " , " })).toThrow(
      /TRUSTED_PROXY_IPS/,
    );
    expect(parseEnv({ NODE_ENV: "development" }).TRUSTED_PROXY_IPS).toEqual([]);
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

describe("NODE_ENV", () => {
  // `source` shapes that must all be validated as production: unset, empty, blank, unknown.
  const notLocal = [
    { label: "unset", value: undefined },
    { label: "empty", value: "" },
    { label: "blank", value: " " },
    { label: "unknown", value: "staging" },
    { label: "miscased", value: "Development" },
  ];

  it.each(notLocal)("is validated as production when $label: no default secrets", ({ value }) => {
    expect(() => parseEnv({ NODE_ENV: value })).toThrow(
      /DATABASE_URL[\s\S]*BETTER_AUTH_SECRET[\s\S]*BETTER_AUTH_URL[\s\S]*TRUSTED_PROXY_IPS/,
    );
  });

  it.each(notLocal)(
    "does not enable test sign-in when $label, even with E2E_AUTH=1",
    ({ value }) => {
      expect(() => parseEnv({ ...productionEnv, NODE_ENV: value, E2E_AUTH: "1" })).toThrow(
        /E2E_AUTH: must not be set in production/,
      );
    },
  );

  it("passes a complete production configuration whether NODE_ENV is set or not", () => {
    const { NODE_ENV: _, ...withoutNodeEnv } = productionEnv;
    expect(parseEnv(withoutNodeEnv).NODE_ENV).toBe("production");
    expect(parseEnv({ ...productionEnv, NODE_ENV: "" }).NODE_ENV).toBe("production");
  });

  it("refuses an unknown value instead of treating it as development", () => {
    expect(() => parseEnv({ ...productionEnv, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it.each(["development", "test"] as const)("keeps the placeholders under explicit %s", (mode) => {
    const parsed = parseEnv({ NODE_ENV: mode });
    expect(parsed.NODE_ENV).toBe(mode);
    expect(parsed.BETTER_AUTH_SECRET).toMatch(/^dev-only-/);
    expect(parsed.TRUSTED_PROXY_IPS).toEqual([]);
  });

  it("still allows E2E_AUTH under an explicit development", () => {
    const parsed = parseEnv({ NODE_ENV: "development", E2E_AUTH: "1" });
    expect(isTestSignInEnabled(parsed)).toBe(true);
  });
});
