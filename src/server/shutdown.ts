/**
 * Orderly shutdown for the production server (server.prod.ts). Docker stops a container with
 * SIGTERM and kills it after 10 seconds, so the server stops what it started and then exits by
 * itself, well inside that. Nothing is left to keep the event loop alive: the database pool's
 * sockets do, if nobody ends it.
 */
import { log } from "./logger.ts";

export interface ShutdownStep {
  /** For the log line when the step fails or the shutdown times out. */
  name: string;
  run: () => unknown;
}

export interface ShutdownOptions {
  /** After this long the process exits with code 1 whatever is still pending. Docker allows 10 s. */
  timeoutMs?: number;
  exit?: (code: number) => void;
  /** Writes out the logger's held-back counts just before exiting. Defaults to the process logger's. */
  flushLogs?: (force: true) => void;
}

/**
 * Returns the shutdown to call on a signal or a crash. It logs `reason`, runs `steps` in order,
 * one failing doesn't skip the rest, then exits `exitCode` (default 0), or 1 if a step failed or
 * the time ran out. Calling it again does nothing.
 */
export function createShutdown(
  steps: readonly ShutdownStep[],
  {
    timeoutMs = 8_000,
    exit = process.exit,
    flushLogs = (force) => log.flush(force),
  }: ShutdownOptions = {},
): (reason: string, exitCode?: number) => Promise<void> {
  let started = false;
  return async (reason, exitCode = 0) => {
    if (started) return;
    started = true;
    log.info("server.shutdown", `${reason}: shutting down`, { reason });
    let pending = "";
    const hardStop = setTimeout(() => {
      log.error("server.shutdown_timeout", `shutdown timed out after ${timeoutMs} ms`, {
        step: pending,
        timeoutMs,
      });
      flushLogs(true);
      exit(1);
    }, timeoutMs);
    let code = exitCode;
    for (const step of steps) {
      pending = step.name;
      try {
        await step.run();
      } catch (error) {
        log.error("server.shutdown_step_failed", `shutdown: ${step.name} failed`, {
          step: step.name,
          err: error,
        });
        code = 1;
      }
    }
    clearTimeout(hardStop);
    flushLogs(true);
    exit(code);
  };
}
