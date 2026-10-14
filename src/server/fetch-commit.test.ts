import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { COMMIT_URL, fetchCommit, INFO_REFS_URL } from "../../scripts/fetch-commit.ts";

// A real `info/refs?service=git-upload-pack` answer for this repo (2026-10-14), trimmed to whole
// pkt-lines: the service line, the HEAD line with its capabilities, two branches, one pull ref.
// `main` is ab20d8910fb4a257ced063605e302b65ac66de51.
const INFO_REFS = readFileSync(new URL("./fixtures/info-refs-upload-pack.bin", import.meta.url));
const MAIN_SHA = "ab20d8910fb4a257ced063605e302b65ac66de51";
const REST_SHA = "8c2a05c7839226a8d4ab1ffdaf8cf7fc5250baa8";

type Reply = Response | Error | "hang";

/** A fetch that answers per URL, and records the URLs asked in order. */
const github = (replies: { infoRefs?: Reply; rest?: Reply }) => {
  const asked: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    asked.push(href);
    const reply = href === INFO_REFS_URL ? replies.infoRefs : replies.rest;
    if (reply === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    if (reply instanceof Error) throw reply;
    return reply ?? new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
};

const infoRefs = (body: BodyInit, status = 200) => new Response(body, { status });

describe("fetchCommit (the Docker build's commit lookup)", () => {
  it("reads main from git's smart-HTTP ref advertisement, not the REST API", async () => {
    const { fetchImpl, asked } = github({ infoRefs: infoRefs(INFO_REFS) });
    expect(await fetchCommit(fetchImpl)).toBe(MAIN_SHA);
    expect(asked).toEqual([INFO_REFS_URL]);
    expect(INFO_REFS_URL).toBe(
      "https://github.com/theHimanshuShekhar/BhayanakCast.git/info/refs?service=git-upload-pack",
    );
    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("user-agent")).toBeTruthy();
  });

  describe("an info/refs body with no usable main", () => {
    const pkt = (payload: string) =>
      `${(payload.length + 4).toString(16).padStart(4, "0")}${payload}`;
    const OTHER = "b66c3a99981727920090a1be5dd4db48e7a8cade";
    const advert = (...refs: string[]) =>
      `${pkt("# service=git-upload-pack\n")}0000${refs.map((ref) => pkt(`${ref}\n`)).join("")}0000`;

    // With the REST API also down, what the parser said is what comes out.
    const lookup = (body: BodyInit) =>
      fetchCommit(github({ infoRefs: infoRefs(body), rest: infoRefs("", 403) }).fetchImpl);

    it("falls back to the REST API when main is missing from the list", async () => {
      const noMain = advert(`${OTHER} refs/heads/dependabot/docker/node-143494b`);
      const { fetchImpl, asked } = github({
        infoRefs: infoRefs(noMain),
        rest: infoRefs(`${REST_SHA}\n`),
      });
      expect(await fetchCommit(fetchImpl)).toBe(REST_SHA);
      expect(asked).toEqual([INFO_REFS_URL, COMMIT_URL]);
    });

    it("is unknown when main is missing and the REST API is down too", async () => {
      expect(await lookup(advert(`${OTHER} refs/heads/feature`))).toBe("unknown");
      expect(await lookup(advert())).toBe("unknown");
    });

    it("does not mistake another ref for main", async () => {
      const lookalikes = advert(
        `${OTHER} refs/heads/main-old`,
        `${OTHER} refs/heads/feature/main`,
        `${OTHER} refs/pull/1/main`,
        `${OTHER} refs/tags/main`,
        `${OTHER} refs/heads/Main`,
      );
      expect(await lookup(lookalikes)).toBe("unknown");
    });

    it("finds main wherever it sits in the list, and takes its own SHA", async () => {
      const first = advert(`${MAIN_SHA} refs/heads/main`, `${OTHER} refs/heads/z`);
      const last = advert(`${OTHER} refs/heads/a`, `${MAIN_SHA} refs/heads/main`);
      expect(await lookup(first)).toBe(MAIN_SHA);
      expect(await lookup(last)).toBe(MAIN_SHA);
    });

    it("is unknown for a body that isn't pkt-lines", async () => {
      expect(await lookup("<html>Service Unavailable</html>")).toBe("unknown");
      expect(await lookup("")).toBe("unknown");
      expect(await lookup("zzzz# service=git-upload-pack\n")).toBe("unknown");
      expect(await lookup(`${MAIN_SHA} refs/heads/main\n`)).toBe("unknown");
    });

    it("is unknown for lengths that lie", async () => {
      const line = `${MAIN_SHA} refs/heads/main\n`;
      expect(await lookup(`0003${line}`)).toBe("unknown"); // shorter than its own prefix
      expect(await lookup(`ffff${line}`)).toBe("unknown"); // runs past the end
      expect(await lookup(advert(`${MAIN_SHA} refs/heads/main`).slice(0, -20))).toBe("unknown"); // cut off
    });

    it("rejects a main that isn't a 40-hex SHA", async () => {
      expect(await lookup(advert("ab20d89 refs/heads/main"))).toBe("unknown");
      expect(await lookup(advert(`${MAIN_SHA.toUpperCase()} refs/heads/main`))).toBe("unknown");
      expect(await lookup(advert(`${MAIN_SHA}0 refs/heads/main`))).toBe("unknown");
      expect(await lookup(advert(`${"g".repeat(40)} refs/heads/main`))).toBe("unknown");
    });
  });

  describe("timeouts", () => {
    it("gives up on an info/refs that never answers, and tries the REST API", async () => {
      const { fetchImpl, asked } = github({ infoRefs: "hang", rest: infoRefs(`${REST_SHA}\n`) });
      expect(await fetchCommit(fetchImpl, 20)).toBe(REST_SHA);
      expect(asked).toEqual([INFO_REFS_URL, COMMIT_URL]);
    });

    it("is unknown when neither ever answers", async () => {
      const { fetchImpl } = github({ infoRefs: "hang", rest: "hang" });
      expect(await fetchCommit(fetchImpl, 20)).toBe("unknown");
    });

    it("gives each request the 10 s timeout by default", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      try {
        await fetchCommit(github({}).fetchImpl);
        expect(timeout.mock.calls).toEqual([[10_000], [10_000]]);
      } finally {
        timeout.mockRestore();
      }
    });
  });

  describe("fallback order: info/refs, then the REST API, then unknown", () => {
    const rest = () => new Response(`${REST_SHA}\n`);

    it("asks the REST API for the bare SHA only after info/refs fails", async () => {
      const { fetchImpl, asked } = github({
        infoRefs: infoRefs("rate limited", 429),
        rest: rest(),
      });
      expect(await fetchCommit(fetchImpl)).toBe(REST_SHA);
      expect(asked).toEqual([INFO_REFS_URL, COMMIT_URL]);
      const init = vi.mocked(fetchImpl).mock.calls[1]?.[1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(headers.get("accept")).toBe("application/vnd.github.sha");
      expect(headers.get("user-agent")).toBeTruthy();
    });

    it("falls back when info/refs is unreachable", async () => {
      const { fetchImpl, asked } = github({
        infoRefs: new TypeError("fetch failed"),
        rest: rest(),
      });
      expect(await fetchCommit(fetchImpl)).toBe(REST_SHA);
      expect(asked).toEqual([INFO_REFS_URL, COMMIT_URL]);
    });

    it("is unknown when both fail, with 403 from the REST API's spent quota", async () => {
      const { fetchImpl, asked } = github({
        infoRefs: infoRefs("", 503),
        rest: new Response("rate limit exceeded", { status: 403 }),
      });
      expect(await fetchCommit(fetchImpl)).toBe("unknown");
      expect(asked).toEqual([INFO_REFS_URL, COMMIT_URL]);
    });

    it("is unknown offline, without throwing", async () => {
      const { fetchImpl } = github({
        infoRefs: new TypeError("fetch failed"),
        rest: new TypeError("fetch failed"),
      });
      expect(await fetchCommit(fetchImpl)).toBe("unknown");
    });

    it("is unknown when the REST answer isn't a commit hash", async () => {
      for (const body of ["<html>Service Unavailable</html>", "", `${REST_SHA}\nextra`]) {
        const { fetchImpl } = github({ infoRefs: infoRefs("", 503), rest: new Response(body) });
        expect(await fetchCommit(fetchImpl)).toBe("unknown");
      }
    });
  });
});
