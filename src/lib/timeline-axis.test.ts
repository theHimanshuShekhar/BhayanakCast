import { describe, expect, it } from "vitest";
import {
  axisTicks,
  browserZone,
  brushView,
  clipSpan,
  clockLabel,
  dateTimeLabel,
  fullView,
  INCIDENT_WINDOW_MS,
  MIN_VIEW_MS,
  panView,
  viewFraction,
  windowAround,
  zoneName,
  zoomView,
} from "./timeline-axis";

const UTC = "UTC";
const IST = "Asia/Kolkata";
const NY = "America/New_York";
const SEC = 1_000;
const MIN = 60 * SEC;
/** 2026-10-10 22:30:00 UTC */
const T0 = Date.UTC(2026, 9, 10, 22, 30, 0);
const domain = { t0: T0, t1: T0 + 15 * MIN };

describe("fullView", () => {
  it("shows the whole domain", () => {
    expect(fullView(domain)).toEqual(domain);
  });

  it("never shows less than the least a view can be, even for an instant", () => {
    expect(fullView({ t0: T0, t1: T0 })).toEqual({ t0: T0, t1: T0 + MIN_VIEW_MS });
  });
});

describe("zoomView", () => {
  it("zooming in by half keeps the time under the pointer where it was", () => {
    const view = fullView(domain);
    const anchor = T0 + 3 * MIN; // a fifth of the way along
    const zoomed = zoomView(view, domain, 0.5, viewFraction(view, anchor));
    expect(zoomed.t1 - zoomed.t0).toBe(7.5 * MIN);
    expect(viewFraction(zoomed, anchor)).toBeCloseTo(0.2, 10);
  });

  it("zooms about the middle when no anchor is given", () => {
    const zoomed = zoomView(fullView(domain), domain, 0.5);
    expect(zoomed).toEqual({ t0: T0 + 3.75 * MIN, t1: T0 + 11.25 * MIN });
  });

  it("cannot go closer than the least view, so a 40 second share is reachable but a point is not", () => {
    let view = fullView(domain);
    for (let i = 0; i < 40; i++) view = zoomView(view, domain, 0.5);
    expect(view.t1 - view.t0).toBe(MIN_VIEW_MS);
  });

  it("cannot go out past the domain, and zooming out at the edge slides back inside", () => {
    const view = { t0: T0, t1: T0 + 2 * MIN };
    const out = zoomView(view, domain, 4, 0);
    expect(out).toEqual({ t0: T0, t1: T0 + 8 * MIN });
    expect(zoomView(out, domain, 10)).toEqual(domain);
    // Anchored on the right edge of a view that touches the end of the domain.
    const tail = { t0: domain.t1 - 2 * MIN, t1: domain.t1 };
    expect(zoomView(tail, domain, 2, 1)).toEqual({ t0: domain.t1 - 4 * MIN, t1: domain.t1 });
  });
});

describe("panView", () => {
  it("moves the view along, and stops at either end of the domain", () => {
    const view = { t0: T0 + 5 * MIN, t1: T0 + 7 * MIN };
    expect(panView(view, domain, MIN)).toEqual({ t0: T0 + 6 * MIN, t1: T0 + 8 * MIN });
    expect(panView(view, domain, 60 * MIN)).toEqual({ t0: domain.t1 - 2 * MIN, t1: domain.t1 });
    expect(panView(view, domain, -60 * MIN)).toEqual({ t0: T0, t1: T0 + 2 * MIN });
  });
});

describe("brushView", () => {
  it("takes the selected range whichever way it was dragged", () => {
    const a = T0 + 4 * MIN;
    const b = T0 + 6 * MIN;
    expect(brushView(domain, a, b)).toEqual({ t0: a, t1: b });
    expect(brushView(domain, b, a)).toEqual({ t0: a, t1: b });
  });

  it("widens a sliver to the least view and keeps it inside the domain", () => {
    const sliver = brushView(domain, T0 + 5 * MIN, T0 + 5 * MIN + 100);
    expect(sliver.t1 - sliver.t0).toBe(MIN_VIEW_MS);
    expect(sliver.t0).toBeGreaterThanOrEqual(T0 + 5 * MIN - MIN_VIEW_MS);
    const pastEnd = brushView(domain, domain.t1 - 100, domain.t1 + 5 * MIN);
    expect(pastEnd.t1).toBe(domain.t1);
    expect(pastEnd.t1 - pastEnd.t0).toBe(MIN_VIEW_MS);
  });
});

describe("clipSpan", () => {
  const view = { t0: T0 + 5 * MIN, t1: T0 + 7 * MIN };

  it("leaves a span inside the view as it is", () => {
    const span = clipSpan(view, T0 + 5.5 * MIN, T0 + 6 * MIN);
    expect(span).toEqual({
      from: T0 + 5.5 * MIN,
      to: T0 + 6 * MIN,
      cutStart: false,
      cutEnd: false,
    });
  });

  it("cuts a span that runs past either side, and says so", () => {
    expect(clipSpan(view, T0, T0 + 6 * MIN)).toEqual({
      from: view.t0,
      to: T0 + 6 * MIN,
      cutStart: true,
      cutEnd: false,
    });
    expect(clipSpan(view, T0 + 6 * MIN, T0 + 20 * MIN)).toMatchObject({
      to: view.t1,
      cutEnd: true,
    });
  });

  it("drops a span entirely outside the view, but keeps one that only touches it", () => {
    expect(clipSpan(view, T0, T0 + 4 * MIN)).toBeNull();
    expect(clipSpan(view, T0 + 8 * MIN, T0 + 9 * MIN)).toBeNull();
    expect(clipSpan(view, T0 + 4 * MIN, view.t0)).not.toBeNull();
  });

  it("keeps an instant (a span of no length) that falls in the view", () => {
    expect(clipSpan(view, T0 + 6 * MIN, T0 + 6 * MIN)).not.toBeNull();
    expect(clipSpan(view, T0 + 9 * MIN, T0 + 9 * MIN)).toBeNull();
  });
});

describe("axisTicks", () => {
  it("steps by round times: minutes over a quarter of an hour, seconds when zoomed in", () => {
    const wide = axisTicks(fullView(domain), 8, UTC);
    expect(wide.map((t) => t.label)).toEqual([
      "22:30",
      "22:32",
      "22:34",
      "22:36",
      "22:38",
      "22:40",
      "22:42",
      "22:44",
    ]);
    const close = axisTicks({ t0: T0 + 5 * MIN + 3 * SEC, t1: T0 + 5 * MIN + 43 * SEC }, 8, UTC);
    expect(close.map((t) => t.label)).toEqual([
      "22:35:05",
      "22:35:10",
      "22:35:15",
      "22:35:20",
      "22:35:25",
      "22:35:30",
      "22:35:35",
      "22:35:40",
    ]);
  });

  it("only gives ticks inside the view, and none that read the same", () => {
    const view = { t0: T0 + 3 * SEC, t1: T0 + 5 * SEC };
    const ticks = axisTicks(view, 8, UTC);
    expect(ticks.every((t) => t.t >= view.t0 && t.t <= view.t1)).toBe(true);
    expect(new Set(ticks.map((t) => t.label)).size).toBe(ticks.length);
  });

  it("reads in the zone it is given, with ticks on round local times", () => {
    // 22:30 UTC is 04:00 the next day in Kolkata (UTC+5:30).
    const ist = axisTicks({ t0: T0, t1: T0 + 10 * MIN }, 5, IST);
    expect(ist.map((t) => t.label)).toEqual(["04:00", "04:02", "04:04", "04:06", "04:08", "04:10"]);
    // A step of an hour falls on the local hour, not on UTC's, which in a half-hour zone is :30.
    const hours = axisTicks({ t0: T0, t1: T0 + 6 * 60 * MIN }, 8, IST).map((t) => t.label);
    expect(hours.length).toBeGreaterThan(2);
    expect(hours.every((label) => label.endsWith(":00") || label.endsWith(":30"))).toBe(true);
    expect(hours.every((label) => label.endsWith(":00"))).toBe(true);
  });

  it("follows daylight saving: the same instants read an hour apart either side of the change", () => {
    // New York fell back at 2026-11-01 06:00 UTC (02:00 EDT -> 01:00 EST).
    const before = Date.UTC(2026, 10, 1, 5, 30, 0);
    const after = Date.UTC(2026, 10, 1, 6, 30, 0);
    expect(clockLabel(before, false, NY)).toBe("01:30");
    expect(clockLabel(after, false, NY)).toBe("01:30");
  });
});

describe("clockLabel", () => {
  it("reads the hour, minute and second in a zone", () => {
    expect(clockLabel(T0 + 4 * SEC, true, UTC)).toBe("22:30:04");
    expect(clockLabel(T0, false, IST)).toBe("04:00");
    expect(clockLabel(T0 + 4 * SEC, true, IST)).toBe("04:00:04");
  });

  it("reads in the browser's zone when none is given", () => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(clockLabel(T0, true)).toBe(clockLabel(T0, true, browser));
    expect(browserZone()).toBe(browser);
  });
});

describe("zoneName", () => {
  it("names the zone as the browser would, so a reader knows which one the times are in", () => {
    expect(zoneName(T0, UTC)).toBe("UTC");
    // The name depends on the locale (en-IN says IST, others GMT+5:30), but is never empty.
    expect(zoneName(T0, IST)).toMatch(/^(IST|GMT\+5:30)$/);
    // And follows daylight saving.
    expect(zoneName(Date.UTC(2026, 6, 1), NY)).not.toBe(zoneName(Date.UTC(2026, 0, 1), NY));
  });
});

describe("dateTimeLabel", () => {
  it("reads the day, month and time to the second, with the zone", () => {
    expect(dateTimeLabel(T0 + 5 * MIN + 4 * SEC, UTC)).toBe("10 Oct 22:35:04 UTC");
    expect(dateTimeLabel(Date.UTC(2026, 0, 3, 0, 0, 9), UTC)).toBe("3 Jan 00:00:09 UTC");
  });

  it("changes the date with the zone: late on the 10th in UTC is the 11th in Kolkata", () => {
    const label = dateTimeLabel(T0 + 5 * MIN + 4 * SEC, IST);
    expect(label).toMatch(/^11 Oct 04:05:04 (IST|GMT\+5:30)$/);
  });
});

describe("windowAround", () => {
  const items = [-3, -2.01, -2, -1, 0, 1, 2, 2.01, 5].map((m) => ({ t: T0 + m * MIN }));

  it("keeps what is within two minutes either side, ends included", () => {
    expect(INCIDENT_WINDOW_MS).toBe(2 * MIN);
    const kept = windowAround(items, T0).map((i) => (i.t - T0) / MIN);
    expect(kept).toEqual([-2, -1, 0, 1, 2]);
  });

  it("takes any window size and keeps the order it was given", () => {
    expect(windowAround(items, T0 + 5 * MIN, MIN)).toEqual([{ t: T0 + 5 * MIN }]);
    expect(windowAround([], T0)).toEqual([]);
  });
});
