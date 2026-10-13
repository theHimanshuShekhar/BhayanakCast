import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCommit, shortCommit, startedAt } from "./build-info.ts";

const SHA = "8c2a05c7839226a8d4ab1ffdaf8cf7fc5250baa8";
const dirs: string[] = [];

/** A directory standing for the image's /app, with a COMMIT file holding `contents` (if any). */
function appDir(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "commit-"));
  dirs.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, "COMMIT"), contents);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readCommit", () => {
  it("reads the commit baked into the image", () => {
    expect(readCommit({}, appDir(`${SHA}\n`))).toBe(SHA);
  });

  it("is unknown when the build couldn't fetch it", () => {
    expect(readCommit({}, appDir("unknown\n"))).toBe("unknown");
  });

  it("is unknown without a file, and for anything that isn't a commit hash", () => {
    expect(readCommit({}, appDir())).toBe("unknown");
    expect(readCommit({}, appDir("<html>rate limited</html>"))).toBe("unknown");
    expect(readCommit({}, appDir(""))).toBe("unknown");
  });

  it("lets GIT_COMMIT stand in for the file (local runs)", () => {
    expect(readCommit({ GIT_COMMIT: SHA }, appDir("unknown"))).toBe(SHA);
    expect(readCommit({ GIT_COMMIT: "not a sha" }, appDir())).toBe("unknown");
  });
});

describe("shortCommit", () => {
  it("is the first 7 characters", () => {
    expect(shortCommit(SHA)).toBe("8c2a05c");
  });

  it("keeps unknown as it is", () => {
    expect(shortCommit("unknown")).toBe("unknown");
  });
});

describe("startedAt", () => {
  it("is when the process started, in UTC with milliseconds, and doesn't move", () => {
    const first = startedAt();
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(first)).toBeLessThanOrEqual(Date.now());
    expect(startedAt()).toBe(first);
  });
});
