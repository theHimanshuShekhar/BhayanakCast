/**
 * Sends `console.*` through the logger, so output the server doesn't write itself is as redacted
 * as the rest. TanStack Start prints a server function's whole error with
 * `console.error("Server Fn Error!", error)`: Node would print the error with its own properties,
 * and a failed Drizzle query carries `params` (session tokens, OAuth tokens) and a `cause`. As
 * plain text that would reach the log store unredacted, because Vector ships a line that isn't
 * JSON as it is. Through here it becomes one `console.error` line whose `err` is scrubbed like any
 * other (src/server/logger.ts). Installed first thing in server.prod.ts.
 *
 * The logger writes to `process.stdout` directly, never through `console`, so this can't recurse.
 */
import { log, wasLogged } from "./logger.ts";

const METHODS = ["log", "info", "warn", "error", "debug"] as const;
const LEVELS = { log: "info", info: "info", warn: "warn", error: "error", debug: "debug" } as const;

const CAPTURED = Symbol.for("bhayanakcast.consoleCaptured");

/**
 * Replace `target`'s logging methods (the process's `console` by default) with ones that write a
 * `console.<method>` line through the logger. The strings among the arguments make the message,
 * the first Error becomes `err`, and other objects go in `args`, where the logger redacts them by
 * field name. Once is enough: a second call changes nothing. Returns the function that puts the
 * originals back.
 */
export function captureConsole(target: Console = console): () => void {
  const marked = target as unknown as { [CAPTURED]?: true };
  if (marked[CAPTURED]) return () => {};
  const originals = METHODS.map((method) => [method, target[method]] as const);
  for (const method of METHODS) {
    target[method] = (...args: unknown[]) => {
      try {
        const errors = args.filter((arg): arg is Error => arg instanceof Error);
        const objects = args.filter(
          (arg) => typeof arg === "object" && arg !== null && !(arg instanceof Error),
        );
        const text = args.filter((arg) => typeof arg !== "object" || arg === null).map(String);
        // An error the code that threw it logged already, with more context, isn't repeated.
        if (errors.length > 0 && errors.every(wasLogged) && objects.length === 0) return;
        log[LEVELS[method]](`console.${method}`, text.join(" "), {
          err: errors[0],
          ...(objects.length > 0 ? { args: objects } : {}),
          ...(errors.length > 1 ? { otherErrors: errors.slice(1) } : {}),
        });
      } catch {
        // Logging must not make a console call throw.
      }
    };
  }
  marked[CAPTURED] = true;
  return () => {
    for (const [method, original] of originals) target[method] = original as never;
    delete marked[CAPTURED];
  };
}
