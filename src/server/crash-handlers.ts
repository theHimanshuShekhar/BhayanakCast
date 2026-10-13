/**
 * What the production server does with errors nothing caught (server.prod.ts):
 *
 * - `unhandledRejection`: logged at error, and the server keeps running. One bad promise (a
 *   fire-and-forget write, say) must not drop every room.
 * - `uncaughtException`: logged at error, then the server shuts down through its own shutdown path
 *   (src/server/shutdown.ts: stop taking connections, close the sockets, end the database pool)
 *   and exits 1, and Docker restarts the container (`restart: unless-stopped`). State after an
 *   uncaught exception can't be trusted, so it doesn't carry on.
 *
 * Installing a handler is also what stops Node from exiting by itself, so both are needed.
 */
import { log } from "./logger.ts";

export interface CrashHandlerOptions {
  /** `createShutdown`'s function; called with the exit code the process should end with. */
  shutdown: (reason: string, exitCode: number) => Promise<void> | void;
  /** Defaults to the process; tests pass an emitter. */
  proc?: NodeJS.Process;
  /** Last resort if the shutdown itself throws. Defaults to `process.exit`. */
  exit?: (code: number) => void;
}

/** Returns a function that removes the handlers. */
export function installCrashHandlers({
  shutdown,
  proc = process,
  exit = process.exit,
}: CrashHandlerOptions): () => void {
  let crashing = false;

  const onRejection = (reason: unknown) => {
    try {
      log.error("process.unhandled_rejection", "an unhandled promise rejection; still running", {
        err: reason,
      });
    } catch {
      // A log line that can't be written is no reason to stop a server that is running.
    }
  };

  const onException = (error: unknown) => {
    try {
      log.error("process.uncaught_exception", "an uncaught exception; shutting down", {
        err: error,
      });
    } catch {
      // The shutdown below matters more than the line about it.
    }
    if (crashing) return;
    crashing = true;
    try {
      Promise.resolve(shutdown("uncaughtException", 1)).catch(() => exit(1));
    } catch {
      exit(1);
    }
  };

  proc.on("unhandledRejection", onRejection);
  proc.on("uncaughtException", onException);
  return () => {
    proc.off("unhandledRejection", onRejection);
    proc.off("uncaughtException", onException);
  };
}
