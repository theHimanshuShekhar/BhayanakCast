/**
 * The page's one `ConnectionReporter` (./connection-reporter.ts), wired to the browser: reports go
 * over `reportConnectionFn`, and what is still queued when the page is hidden or closed goes with
 * `navigator.sendBeacon` to `/api/connection-events`. A beacon is a same-origin POST, so the
 * browser attaches the session cookie by itself; the route (src/routes/api/connection-events.ts)
 * reads the session from it exactly as a server function does. The body is a JSON `Blob`; the
 * route parses it whatever content type the browser labels it with.
 *
 * Browser-only: call from effects and event handlers, never during render.
 */
import type { ReportConnectionEventsInput } from "./connection-events";
import { reportConnectionFn } from "./connection-events.functions";
import { ConnectionReporter } from "./connection-reporter";

/** Where `sendBeacon` posts a report (see src/routes/api/connection-events.ts). */
export const CONNECTION_BEACON_PATH = "/api/connection-events";

/** Hand `report` to the browser to send after the page is gone; false if it won't take it. */
export function sendBeaconReport(report: ReportConnectionEventsInput): boolean {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
  const body = new Blob([JSON.stringify(report)], { type: "application/json" });
  return navigator.sendBeacon(CONNECTION_BEACON_PATH, body);
}

let reporter: ConnectionReporter | null = null;

/** The page's `ConnectionReporter`, created on first call. Browser-only. */
export function getConnectionReporter(): ConnectionReporter {
  if (!reporter) {
    const created = new ConnectionReporter({
      send: (report) => reportConnectionFn({ data: report }),
      beacon: sendBeaconReport,
    });
    // `pagehide` is the reliable "page is going" event (it also fires when a page enters the
    // back/forward cache); `visibilitychange` to hidden is the last one a mobile browser gives.
    const flush = () => created.flushOnClose();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    reporter = created;
  }
  return reporter;
}
