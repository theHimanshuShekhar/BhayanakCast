/**
 * Log lines that more than one part of the server writes, or that a later ticket will write:
 * slow database writes, dropped reports and the room timeline. Everything else logs through
 * ./logger.ts at its own call site.
 */
import type { TimelineEventRow } from "../lib/room-timeline.ts";
import { type LogFields, log } from "./logger.ts";

/**
 * A database write that takes longer than this is logged at warn as `db.slow_write`. Healthy
 * writes here are indexed lookups and small inserts that finish in a few milliseconds, the hub
 * runs every operation on one serial queue (a slow write delays every room), and Postgres cancels
 * a statement at 10 s (`STATEMENT_TIMEOUT_MS`), so half a second is slow enough to matter and
 * rare enough not to be noise. Documented in docs/deploy.md ("Logs").
 */
export const SLOW_WRITE_MS = 500;

/**
 * Run `write`, and log `db.slow_write` (warn) if it took `thresholdMs` or longer, whether it
 * succeeded or threw. The result or the error goes on to the caller untouched.
 */
export async function timedWrite<T>(
  operation: string,
  write: () => Promise<T> | T,
  fields: LogFields = {},
  thresholdMs: number = SLOW_WRITE_MS,
): Promise<T> {
  const started = performance.now();
  let failed = false;
  try {
    return await write();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const ms = Math.round(performance.now() - started);
    if (ms >= thresholdMs) {
      log.warn("db.slow_write", `${operation} took ${ms} ms`, {
        ...fields,
        operation,
        ms,
        thresholdMs,
        ...(failed ? { failed } : {}),
      });
    }
  }
}

/**
 * `store` with each function property `isWrite` accepts timed by `timedWrite`, under the
 * property's name. The other properties are kept as they are.
 */
export function withSlowWriteLog<S extends object>(
  store: S,
  isWrite: (name: string) => boolean,
  thresholdMs: number = SLOW_WRITE_MS,
): S {
  const timed: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(store)) {
    timed[name] =
      typeof value === "function" && isWrite(name)
        ? (...args: unknown[]) => timedWrite(name, () => value.apply(store, args), {}, thresholdMs)
        : value;
  }
  return timed as S;
}

export type DroppedReport = "quality" | "connection_event" | "problem";

/**
 * A report from a page that the server threw away (not in the room, over a limit, invalid), as
 * `<report>.dropped` at warn. Quality reports use it today; the connection-event and problem
 * reports will, so a missing report can be told from one that was never sent.
 */
export function logReportDropped(report: DroppedReport, reason: string, fields: LogFields = {}) {
  log.warn(`${report}.dropped`, `${report.replace("_", " ")} report dropped: ${reason}`, {
    ...fields,
    reason,
  });
}

/**
 * The room timeline recorded an event: also logged at info as `timeline.<kind>`, so the log
 * viewer can follow a user or a room across rooms. Called by the recorder
 * (src/server/room-timeline.ts) with what the row carries; chat content is never in it.
 */
export function logTimelineEvent(event: { kind: string; roomId: string } & LogFields): void {
  const { kind, ...fields } = event;
  log.info(`timeline.${kind}`, `timeline: ${kind}`, fields);
}

/**
 * `logTimelineEvent` for a stored row, for whoever records one (the hub's recorder, and the
 * connection events a browser reports). Never throws: the log being down is no reason to fail the
 * write it describes.
 *
 * A problem report's note is for admins on the room timeline only (ADR 4 addendum on problem
 * reports): the line says how long it was (`noteChars`), never what it said.
 */
export function logTimelineRow(row: TimelineEventRow): void {
  try {
    let details = row.details;
    if (row.kind === "problem_report") {
      const { note, ...rest } = details;
      details = typeof note === "string" ? { ...rest, noteChars: note.length } : rest;
    }
    logTimelineEvent({
      kind: row.kind,
      roomId: row.roomId,
      userId: row.actorUserId ?? undefined,
      targetUserId: row.targetUserId ?? undefined,
      at: row.at.toISOString(),
      details,
    });
  } catch {
    // The log is down; the timeline row is not affected.
  }
}

/**
 * Recording timeline events failed: a write that threw or timed out, or events lost at shutdown
 * (src/server/room-timeline.ts). The room carries on without them.
 */
export function logTimelineWriteFailed(
  error: unknown,
  fields: LogFields = {},
  msg = "recording a timeline event failed",
): void {
  log.error("timeline.write_failed", msg, { ...fields, err: error });
}

/**
 * A peer outside `TRUSTED_PROXY_IPS` sent `cf-connecting-ip` and it was ignored (once per peer,
 * src/server/client-ip.ts). The line leaves out the peer's address, as no IP address is logged:
 * the operator knows the cloudflared host's, and docs/deploy.md (step 2) says where to look.
 */
export function logUntrustedProxy(): void {
  log.warn(
    "http.untrusted_proxy",
    "Ignoring cf-connecting-ip from a peer that isn't in TRUSTED_PROXY_IPS. " +
      "If it is the cloudflared host, add its address there (docs/deploy.md).",
  );
}
