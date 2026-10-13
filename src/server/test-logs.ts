/**
 * Read what the server logged, from a test: the process logger's lines (src/server/logger.ts)
 * collected as parsed objects instead of written to stdout.
 *
 *   const logs = captureLogs();            // beforeEach
 *   afterEach(() => logs.restore());
 *   expect(logs.find("socket.refused")).toMatchObject({ level: "warn", type: "chat.send" });
 */
import { redirectProcessLog } from "./logger.ts";

export interface LoggedLine {
  time: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  msg: string;
  commit: string;
  roomId?: string;
  userId?: string;
  requestId?: string;
  err?: { name: string; message: string; stack?: string };
  [field: string]: unknown;
}

export interface CapturedLogs {
  /** Every line so far, oldest first. */
  readonly entries: LoggedLine[];
  /** The raw lines, as written. */
  readonly lines: string[];
  /** Lines of `event`. */
  all(event: string): LoggedLine[];
  /** The first line of `event`, if any. */
  find(event: string): LoggedLine | undefined;
  /** Whether a line's `msg` mentions `text`. */
  mentions(text: string): boolean;
  /** Put stdout back. */
  restore(): void;
}

export function captureLogs(): CapturedLogs {
  const lines: string[] = [];
  const entries: LoggedLine[] = [];
  const restore = redirectProcessLog((line) => {
    lines.push(line);
    entries.push(JSON.parse(line) as LoggedLine);
  });
  return {
    entries,
    lines,
    all: (event) => entries.filter((entry) => entry.event === event),
    find: (event) => entries.find((entry) => entry.event === event),
    mentions: (text) => entries.some((entry) => entry.msg.includes(text)),
    restore,
  };
}
