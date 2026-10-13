import { describe, expect, it, vi } from "vitest";
import { COMMIT_URL, fetchCommit } from "../../scripts/fetch-commit.ts";

const SHA = "8c2a05c7839226a8d4ab1ffdaf8cf7fc5250baa8";

const answer = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

describe("fetchCommit (the Docker build's commit lookup)", () => {
  it("asks GitHub for main's latest commit as a bare SHA", async () => {
    const fetchImpl = answer(`${SHA}\n`);
    expect(await fetchCommit(fetchImpl)).toBe(SHA);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.com/repos/theHimanshuShekhar/BhayanakCast/commits/main");
    expect(COMMIT_URL).toBe(url);
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("accept")).toBe("application/vnd.github.sha");
    expect(headers.get("user-agent")).toBeTruthy();
  });

  it("is unknown when GitHub is down, rate limiting or erroring", async () => {
    expect(await fetchCommit(answer("rate limit exceeded", 403))).toBe("unknown");
    expect(await fetchCommit(answer("", 503))).toBe("unknown");
  });

  it("is unknown when there is no network", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await fetchCommit(offline)).toBe("unknown");
  });

  it("is unknown when the answer isn't a commit hash", async () => {
    expect(await fetchCommit(answer("<html>Service Unavailable</html>"))).toBe("unknown");
    expect(await fetchCommit(answer(""))).toBe("unknown");
    expect(await fetchCommit(answer(`${SHA}\nextra`))).toBe("unknown");
  });

  it("gives up on a GitHub that never answers", async () => {
    const hung = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    expect(await fetchCommit(hung, 20)).toBe("unknown");
  });
});
