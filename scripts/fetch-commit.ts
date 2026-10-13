/**
 * Prints the SHA of `main`'s latest commit, or `unknown`. The Dockerfile runs it at build time and
 * bakes the output into the image as `COMMIT` (src/server/build-info.ts), because Dockhand copies
 * the repo without `.git` and passes no commit variable (docs/deploy.md, "Logs").
 *
 * It never fails: GitHub being down, rate limiting the build host, or the host being offline
 * gives `unknown`, and the build goes on. The answer is `main`'s newest commit when the build
 * asks, which is the commit being deployed unless a push lands in the seconds between Dockhand's
 * clone and this request.
 */

export const COMMIT_URL =
  "https://api.github.com/repos/theHimanshuShekhar/BhayanakCast/commits/main";

const UNKNOWN = "unknown";
const FETCH_TIMEOUT_MS = 10_000;

export async function fetchCommit(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<string> {
  try {
    const response = await fetchImpl(COMMIT_URL, {
      // The SHA media type: the body is the 40-character hash and nothing else.
      headers: { accept: "application/vnd.github.sha", "user-agent": "bhayanakcast-docker-build" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return UNKNOWN;
    const sha = (await response.text()).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

if (import.meta.main) {
  process.stdout.write(`${await fetchCommit()}\n`);
}
