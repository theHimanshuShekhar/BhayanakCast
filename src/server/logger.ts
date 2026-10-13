/**
 * The server's one logger (ADR 9 addendum, "Logs"): a JSON object per line on stdout, which
 * Vector ships to VictoriaLogs (docs/deploy.md). Every server-side `console.*` goes through it.
 *
 *   log.warn("socket.refused", "Too many requests", { roomId, userId, type: "chat.send" });
 *
 * Fields: `time` (UTC, ms), `level`, `event` (a dotted name to count and filter on), `msg`,
 * `commit`, then `roomId`, `userId`, `requestId`, `err {name, message, stack}` and any extra flat
 * fields (`type`, `reason`, `route`, ...) when given.
 *
 * - **Levels:** `error` needs fixing; `warn` is something refused, dropped or degraded; `info` is
 *   the socket and room timeline lifecycle; `debug` is off in production (`resolveLogLevel`).
 * - **Sampling:** the same event from the same user (or socket) is written in full for its first
 *   `LOG_SAMPLE_LIMIT` lines in a minute, then as one count line (`suppressed: N`) for the rest.
 *   Errors are keyed by their message too, so a different error is always written.
 * - **Never logged:** IP addresses, chat content, tokens and session ids. Fields with such names
 *   are replaced, and addresses and credentials are scrubbed out of messages and errors. This is a
 *   net under the call sites, which should not pass them in the first place.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getCommit } from "./build-info.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogThreshold = LogLevel | "silent";

const RANK: Record<LogThreshold, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

/** Lines of one event from one user (or socket) written in full per `LOG_SAMPLE_WINDOW_MS`. */
export const LOG_SAMPLE_LIMIT = 10;
export const LOG_SAMPLE_WINDOW_MS = 60_000;
/** Sampling counters kept at once; past this the oldest are written out and forgotten. */
const MAX_TRACKED = 5_000;
const MAX_MESSAGE_CHARS = 1_000;
const MAX_ERROR_MESSAGE_CHARS = 2_000;
const MAX_STACK_CHARS = 8_000;
const MAX_DEPTH = 4;
const MAX_KEYS = 50;

export interface LogFields {
  roomId?: string;
  userId?: string;
  requestId?: string;
  /** A thrown value; written as `err {name, message, stack}`. */
  err?: unknown;
  /** The hub's connection id: sampling counts per socket for lines with no user. */
  socketId?: number;
  /**
   * What to count by when a line has no user or socket (a client address, say). Used for
   * sampling only and never written.
   */
  sampleKey?: string;
  [field: string]: unknown;
}

export interface Logger {
  debug(event: string, msg: string, fields?: LogFields): void;
  info(event: string, msg: string, fields?: LogFields): void;
  warn(event: string, msg: string, fields?: LogFields): void;
  error(event: string, msg: string, fields?: LogFields): void;
  /**
   * Write the count lines of sampling windows that have ended (`force`: of all of them, for a
   * process about to exit). The process logger does this by itself every few seconds.
   */
  flush(force?: boolean): void;
  /** Forget the sampling counters without writing them (a test starting afresh). */
  reset(): void;
}

export interface LoggerOptions {
  /** Receives each line, without its newline. */
  write: (line: string) => void;
  now?: () => number;
  commit?: string | (() => string);
  /** Checked on every line, so it may change. */
  level?: LogThreshold | (() => LogThreshold);
}

// -------------------------------------------------------------------------------------------
// Level

/**
 * The lowest level written for `env`: `info` in production (and for any unset or unknown
 * NODE_ENV, like src/server/env.ts), `debug` in development and under test, and nothing inside
 * Vitest (its tests read the lines through src/server/test-logs.ts instead). `LOG_LEVEL`
 * overrides it, except that it can't turn debug on in production.
 */
export function resolveLogLevel(env: {
  NODE_ENV?: string;
  LOG_LEVEL?: string;
  VITEST?: string;
}): LogThreshold {
  const local = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  const fallback: LogThreshold = env.VITEST ? "silent" : local ? "debug" : "info";
  const wanted = env.LOG_LEVEL;
  if (!wanted || !(wanted in RANK)) return fallback;
  if (!local && wanted === "debug") return fallback;
  return wanted as LogThreshold;
}

// -------------------------------------------------------------------------------------------
// Redaction

/** Field names (lower case, punctuation removed) whose values are never written. */
const BLOCKED_KEYS = new Set([
  "ip",
  "ips",
  "ipaddress",
  "ipaddr",
  "clientip",
  "remoteip",
  "remoteaddress",
  "remoteaddr",
  "peeraddress",
  "peerip",
  "forwardedfor",
  "xforwardedfor",
  "xrealip",
  "realip",
  "cfconnectingip",
  "session",
  "sessionid",
  "sid",
  "text",
  "content",
  "chat",
  "chattext",
  "body",
]);
const BLOCKED_KEY_PATTERN = /token|secret|password|passwd|cookie|authorization|apikey|credential/;
const REDACTED = "[redacted]";

function isBlockedKey(key: string): boolean {
  const name = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BLOCKED_KEYS.has(name) || BLOCKED_KEY_PATTERN.test(name);
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const HEX_GROUP = "[0-9a-f]{1,4}";
const IPV6 = new RegExp(
  `(?<![\\w:])(?:(?:${HEX_GROUP}:){7}${HEX_GROUP}|(?:${HEX_GROUP}:){1,7}:(?:${HEX_GROUP}(?::${HEX_GROUP}){0,6})?|::(?:${HEX_GROUP}(?::${HEX_GROUP}){0,6})?)(?![\\w:])`,
  "gi",
);
const BEARER = /\bBearer\s+\S+/gi;
const CREDENTIAL_PAIR =
  /\b([\w.-]*(?:token|secret|password|passwd|cookie|authorization|apikey|sessionid|session_id)[\w.-]*)\s*[=:]\s*[^\s,;&)"']+/gi;

/** `text` without IP addresses, bearer tokens or `token=...` style pairs. */
function scrubText(text: string): string {
  return text
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(CREDENTIAL_PAIR, `$1=${REDACTED}`)
    .replace(IPV4, "[ip]")
    .replace(IPV6, "[ip]");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined || typeof value === "function" || typeof value === "symbol")
    return undefined;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) return describeError(value);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => scrubValue(item, depth + 1) ?? null);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
    const scrubbed = isBlockedKey(key) ? REDACTED : scrubValue(item, depth + 1);
    if (scrubbed !== undefined) out[key] = scrubbed;
  }
  return out;
}

export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
}

/** A thrown value as `{name, message, stack}`, scrubbed and with the stack as one string. */
export function describeError(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const info: ErrorInfo = {
      name: error.name,
      message: clip(scrubText(error.message), MAX_ERROR_MESSAGE_CHARS),
    };
    if (error.stack) info.stack = clip(scrubText(error.stack), MAX_STACK_CHARS);
    return info;
  }
  return { name: "NonError", message: clip(scrubText(String(error)), MAX_ERROR_MESSAGE_CHARS) };
}

// -------------------------------------------------------------------------------------------
// Request context

interface RequestLogContext {
  requestId?: string;
  route?: string;
  userId?: string;
}

/**
 * Process-wide state, on a global: the SSR bundle and server.prod.ts each load their own copy of
 * this module, and a request's context, the sampling counters and the marks on logged errors
 * must be seen by both (the same reason as the database pool, src/db/client.ts).
 */
const STATE = Symbol.for("bhayanakcast.logState");
interface LogState {
  requests: AsyncLocalStorage<RequestLogContext>;
  /** Errors already written, so a catch further out doesn't write them again. */
  logged: WeakSet<object>;
  write?: (line: string) => void;
  level?: LogThreshold;
  logger?: Logger;
}
const registry = globalThis as { [STATE]?: LogState };
function state(): LogState {
  registry[STATE] ??= { requests: new AsyncLocalStorage(), logged: new WeakSet() };
  return registry[STATE];
}

/** Lines written inside `run` carry `context` (a request id, its route) and its bound user. */
export function withRequestLog<T>(context: RequestLogContext, run: () => T): T {
  return state().requests.run({ ...context }, run);
}

/** Say who the current request is, for the lines written during the rest of it. */
export function bindLogUser(userId: string | undefined): void {
  const context = state().requests.getStore();
  if (context && userId) context.userId = userId;
}

/** Whether `error` has been written by a logger already (`err` of an earlier line). */
export function wasLogged(error: unknown): boolean {
  return typeof error === "object" && error !== null && state().logged.has(error);
}

/** The path of `url` for a log line: no query, and no invite token (`/join/<token>`). */
export function routeOf(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    return "/";
  }
  return pathname.replace(/^\/join\/[^/]+/, "/join/:token");
}

// -------------------------------------------------------------------------------------------
// The logger

interface Window {
  start: number;
  written: number;
  suppressed: number;
  level: LogLevel;
  event: string;
  who: Pick<LogFields, "roomId" | "userId" | "socketId">;
}

export function createLogger(options: LoggerOptions): Logger {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();
  const commit = () =>
    typeof options.commit === "string" ? options.commit : (options.commit ?? getCommit)();
  const threshold = () =>
    typeof options.level === "function" ? options.level() : (options.level ?? "debug");

  function emit(
    level: LogLevel,
    event: string,
    msg: string,
    fields: LogFields,
    at: number,
    inRequest = true,
  ): void {
    const { roomId, userId, requestId, err, socketId, sampleKey: _sampleKey, ...extra } = fields;
    const context = inRequest ? state().requests.getStore() : undefined;
    const line: Record<string, unknown> = {
      time: new Date(at).toISOString(),
      level,
      event,
      msg: clip(scrubText(msg), MAX_MESSAGE_CHARS),
      commit: commit(),
    };
    const ids = {
      roomId,
      userId: userId ?? context?.userId,
      requestId: requestId ?? context?.requestId,
    };
    // The ids are ours, but a request id may come from a header: scrubbed like the rest.
    for (const [key, value] of Object.entries(ids)) {
      if (typeof value === "string") line[key] = clip(scrubText(value), 128);
    }
    if (socketId !== undefined) line.socketId = socketId;
    if (context?.route !== undefined && extra.route === undefined) line.route = context.route;
    if (err !== undefined) {
      line.err = describeError(err);
      if (typeof err === "object" && err !== null) state().logged.add(err);
    }
    for (const [key, value] of Object.entries(extra)) {
      if (key in line && key !== "route") continue;
      const scrubbed = isBlockedKey(key) ? REDACTED : scrubValue(value, 1);
      if (scrubbed !== undefined) line[key] = scrubbed;
    }
    const write = options.write;
    write(JSON.stringify(line));
  }

  function summarise(window: Window, at: number): void {
    if (window.suppressed === 0) return;
    emit(
      window.level,
      window.event,
      `${window.event}: ${window.suppressed} more in the last minute, not written`,
      { ...window.who, suppressed: window.suppressed },
      at,
      // Written now, about lines of earlier requests: not of whichever one is running.
      false,
    );
  }

  function keyOf(level: LogLevel, event: string, fields: LogFields, msg: string): string {
    const who =
      fields.sampleKey ??
      fields.userId ??
      state().requests.getStore()?.userId ??
      fields.socketId ??
      "";
    let key = `${level}|${event}|${who}`;
    // A different error is a different problem: it gets its own count.
    if (level === "error") {
      const message = fields.err instanceof Error ? fields.err.message : (fields.err ?? msg);
      key += `|${String(message)}`;
    }
    return key;
  }

  function log(level: LogLevel, event: string, msg: string, fields: LogFields = {}): void {
    if (RANK[level] < RANK[threshold()]) return;
    const at = now();
    const key = keyOf(level, event, fields, msg);
    let window = windows.get(key);
    if (window && at - window.start >= LOG_SAMPLE_WINDOW_MS) {
      summarise(window, at);
      windows.delete(key);
      window = undefined;
    }
    if (!window) {
      if (windows.size >= MAX_TRACKED) {
        const oldest = windows.entries().next().value;
        if (oldest) {
          summarise(oldest[1], at);
          windows.delete(oldest[0]);
        }
      }
      const { roomId, userId, socketId } = fields;
      window = {
        start: at,
        written: 0,
        suppressed: 0,
        level,
        event,
        who: { roomId, userId: userId ?? state().requests.getStore()?.userId, socketId },
      };
      windows.set(key, window);
    }
    if (window.written < LOG_SAMPLE_LIMIT) {
      window.written++;
      emit(level, event, msg, fields, at);
    } else {
      window.suppressed++;
    }
  }

  return {
    debug: (event, msg, fields) => log("debug", event, msg, fields),
    info: (event, msg, fields) => log("info", event, msg, fields),
    warn: (event, msg, fields) => log("warn", event, msg, fields),
    error: (event, msg, fields) => log("error", event, msg, fields),
    flush(force = false) {
      const at = now();
      for (const [key, window] of windows) {
        if (!force && at - window.start < LOG_SAMPLE_WINDOW_MS) continue;
        summarise(window, at);
        windows.delete(key);
      }
    },
    reset: () => windows.clear(),
  };
}

// -------------------------------------------------------------------------------------------
// The process logger

/** How often the process logger writes the count lines of windows that have ended. */
const FLUSH_EVERY_MS = 15_000;

/**
 * The process's logger: JSON lines on stdout, at the level `resolveLogLevel(process.env)` says.
 * One per process, whichever copy of this module asks.
 */
export const log: Logger = (() => {
  const shared = state();
  if (shared.logger) return shared.logger;
  const logger = createLogger({
    write: (line) => (shared.write ?? writeStdout)(line),
    level: () => shared.level ?? resolveLogLevel(process.env),
  });
  shared.logger = logger;
  setInterval(() => logger.flush(), FLUSH_EVERY_MS).unref();
  return logger;
})();

function writeStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Send the process logger's lines to `write` at `level` instead of stdout; returns the function
 * that puts it back. For tests (src/server/test-logs.ts).
 */
export function redirectProcessLog(
  write: (line: string) => void,
  level: LogThreshold = "debug",
): () => void {
  const shared = state();
  const previous = { write: shared.write, level: shared.level };
  shared.write = write;
  shared.level = level;
  // Sampling counters are per process: start the test with a clean budget, and leave none behind.
  shared.logger?.reset();
  return () => {
    shared.write = previous.write;
    shared.level = previous.level;
    shared.logger?.reset();
  };
}
