/**
 * Orderly shutdown for the production server (server.prod.ts). Docker stops a container with
 * SIGTERM and kills it after 10 seconds, so the server stops what it started and then exits by
 * itself, well inside that. Nothing is left to keep the event loop alive: the database pool's
 * sockets do, if nobody ends it.
 */

export interface ShutdownStep {
  /** For the log line when the step fails or the shutdown times out. */
  name: string;
  run: () => unknown;
}

export interface ShutdownOptions {
  /** After this long the process exits with code 1 whatever is still pending. Docker allows 10 s. */
  timeoutMs?: number;
  exit?: (code: number) => void;
}

/**
 * Returns the shutdown to call on a signal. It runs `steps` in order, one failing doesn't skip the
 * rest, then exits 0, or 1 if a step failed or the time ran out. Calling it again does nothing.
 */
export function createShutdown(
  steps: readonly ShutdownStep[],
  { timeoutMs = 8_000, exit = process.exit }: ShutdownOptions = {},
): (reason: string) => Promise<void> {
  let started = false;
  return async (reason) => {
    if (started) return;
    started = true;
    console.log(`[server] ${reason}: shutting down`);
    let pending = "";
    const hardStop = setTimeout(() => {
      console.error(`[server] shutdown timed out after ${timeoutMs} ms, stuck at: ${pending}`);
      exit(1);
    }, timeoutMs);
    let code = 0;
    for (const step of steps) {
      pending = step.name;
      try {
        await step.run();
      } catch (error) {
        console.error(`[server] shutdown: ${step.name} failed`, error);
        code = 1;
      }
    }
    clearTimeout(hardStop);
    exit(code);
  };
}
