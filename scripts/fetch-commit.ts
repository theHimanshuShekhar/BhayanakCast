/**
 * Prints the SHA of `main`'s latest commit, or `unknown`. The Dockerfile runs it at build time and
 * bakes the output into the image as `COMMIT` (src/server/build-info.ts), because Dockhand copies
 * the repo without `.git` and passes no commit variable (docs/deploy.md, "Logs").
 *
 * It never fails: GitHub being down or the host being offline gives `unknown`, and the build goes
 * on. The answer is `main`'s newest commit when the build asks, which is the commit being deployed
 * unless a push lands in the seconds between Dockhand's clone and this request.
 */

// Where the SHA comes from, in order:
// 1. git's smart-HTTP ref advertisement, plain HTTPS with no API quota: what `git ls-remote` reads.
// 2. The REST API, whose unauthenticated limit is 60 requests an hour per IP, and the homelab's
//    address is shared with everything else on its network (it was used up on 2026-10-14). A
//    second try for when the advertisement fails, and no more than that.
// 3. `unknown`.
export const INFO_REFS_URL =
  "https://github.com/theHimanshuShekhar/BhayanakCast.git/info/refs?service=git-upload-pack";
export const COMMIT_URL =
  "https://api.github.com/repos/theHimanshuShekhar/BhayanakCast/commits/main";

const UNKNOWN = "unknown";
const FETCH_TIMEOUT_MS = 10_000;
const SHA = /^[0-9a-f]{40}$/;
const USER_AGENT = "bhayanakcast-docker-build";

/**
 * Finds `refs/heads/main` in a `git-upload-pack` advertisement. The body is pkt-lines: four hex
 * digits giving the line's length (those four included), then the payload; `0000` is a flush
 * packet with no payload. It opens with `# service=git-upload-pack`, a flush, then one
 * `<40-hex> <refname>` line per ref, the first (HEAD) followed by a NUL and the server's
 * capabilities. Only the exact `refs/heads/main` line matters (HEAD carries main's SHA too, but
 * isn't named main), so this scans every line. Returns undefined for a body that isn't pkt-lines,
 * or has no `main`.
 */
export function parseMainFromInfoRefs(body: Uint8Array): string | undefined {
  const text = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= body.length) {
    const prefix = text.decode(body.subarray(offset, offset + 4));
    if (!/^[0-9a-f]{4}$/.test(prefix)) return undefined;
    const length = Number.parseInt(prefix, 16);
    if (length === 0) {
      offset += 4;
      continue;
    }
    // A length under 4 can't hold its own prefix, and one past the end is a truncated body.
    if (length < 4 || offset + length > body.length) return undefined;
    const line = text
      .decode(body.subarray(offset + 4, offset + length))
      .split("\0", 1)[0]
      ?.replace(/\n$/, "");
    offset += length;
    const match = /^([0-9a-f]{40}) refs\/heads\/main$/.exec(line ?? "");
    if (match) return match[1];
  }
  return undefined;
}

async function fromInfoRefs(fetchImpl: typeof fetch, timeoutMs: number) {
  const response = await fetchImpl(INFO_REFS_URL, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return undefined;
  return parseMainFromInfoRefs(new Uint8Array(await response.arrayBuffer()));
}

async function fromRestApi(fetchImpl: typeof fetch, timeoutMs: number) {
  const response = await fetchImpl(COMMIT_URL, {
    // The SHA media type: the body is the 40-character hash and nothing else.
    headers: { accept: "application/vnd.github.sha", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return undefined;
  const sha = (await response.text()).trim();
  return SHA.test(sha) ? sha : undefined;
}

export async function fetchCommit(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<string> {
  // Each source gets its own timeout and its own catch, so a dead one never costs the next.
  for (const source of [fromInfoRefs, fromRestApi]) {
    try {
      const sha = await source(fetchImpl, timeoutMs);
      if (sha) return sha;
    } catch {}
  }
  return UNKNOWN;
}

if (import.meta.main) {
  process.stdout.write(`${await fetchCommit()}\n`);
}
