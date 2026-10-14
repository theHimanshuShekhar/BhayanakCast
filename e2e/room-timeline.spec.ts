import type { Browser, BrowserContext, Page } from "@playwright/test";
import { E2E_ADMIN_DISCORD_ID, signIn } from "./auth";
import { expect, test } from "./fixtures";
import { createUser, uniqueUsername } from "./profiles";
import { type SeedRoom, seedRoom, uniqueRoomName } from "./rooms";

// The admin's room timeline (#118, CONTEXT.md "Room timeline"; design in #114): an incident view
// when it is opened on a problem report, swimlanes on a time axis as the full view, filters and
// zoom. The room is seeded straight into the database (the events the hub and the browsers
// would have recorded), so the picture is the same every run.

// The admin reads times in their browser's time zone, so it is fixed here: a zone whose offset is
// half an hour (and which a UTC reading could not be mistaken for) keeps the checks stable.
const ZONE = "Asia/Kolkata";
test.use({ timezoneId: ZONE });

type Events = NonNullable<SeedRoom["events"]>;

const MIN = 60_000;
/** A room that began 20 minutes ago and ended 5 minutes ago. */
const BASE = Date.now() - 20 * MIN;
const iso = (sec: number) => new Date(BASE + sec * 1_000).toISOString();
/** The clock in `ZONE` at `sec` into the room, as the page words it: `12:53:11`. */
const clock = (sec: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(BASE + sec * 1_000);

interface Seeded {
  roomId: string;
  roomName: string;
  reportId: string;
  ana: { id: string; username: string };
  bo: { id: string; username: string };
  cy: { id: string; username: string };
}

const REPORT_AT = 305;

/**
 * A 15 minute room of three people with a 40 second share, a connection that flapped, a switch
 * to the relay, and a "frozen" report from `bo` about `ana`'s screen, with a snapshot from each
 * of two browsers.
 */
async function seedTimelineRoom(browser: Browser, context: BrowserContext): Promise<Seeded> {
  const ana = await createUser(browser, uniqueUsername("tl.ana"));
  const bo = await createUser(browser, uniqueUsername("tl.bo"));
  const cy = await createUser(browser, uniqueUsername("tl.cy"));
  const roomName = uniqueRoomName("timeline");
  const reportId = `tl-report-${Math.random().toString(36).slice(2, 10)}`;
  const state = (sec: number, who: string, peer: string, s: string) => ({
    at: iso(sec),
    kind: "pair_state" as const,
    actorUserId: who,
    targetUserId: peer,
    details: { state: s },
  });
  const snapshot = (sec: number, who: string, peers: [string, string][], mine: boolean) => {
    // What the streamer's browser knows of the stream, and what the viewer's received.
    const stream: Record<string, string | number> = mine
      ? { from: ana.id, to: bo.id, step: "720p30", cap: 2_500_000, reason: "shared" }
      : {
          from: ana.id,
          to: bo.id,
          bps: 900_000,
          width: 1280,
          height: 720,
          fps: 8,
          loss: 0.051,
          rttMs: 120,
          path: "relay · UDP",
          ageMs: 900,
        };
    return {
      at: iso(sec),
      kind: "report_snapshot" as const,
      actorUserId: who,
      details: {
        reportId,
        browser: { name: "chrome", version: "141" },
        streams: [stream],
        pairs: peers.map(([peerId, s]) => ({ peerId, state: s })),
      },
    };
  };
  const events: Events = [
    { at: iso(0), kind: "join", actorUserId: ana.id },
    { at: iso(20), kind: "join", actorUserId: bo.id },
    { at: iso(60), kind: "join", actorUserId: cy.id },
    { at: iso(20), kind: "mic_on", actorUserId: ana.id },
    { at: iso(200), kind: "mic_off", actorUserId: ana.id },
    // A 40 second share: a few pixels wide on a 15 minute axis once the page is narrow.
    { at: iso(100), kind: "share_start", actorUserId: ana.id },
    { at: iso(140), kind: "share_stop", actorUserId: ana.id },
    {
      at: iso(150),
      kind: "refusals",
      actorUserId: bo.id,
      details: { counts: { "chat:rate_limited": 3 } },
    },
    state(25, ana.id, bo.id, "connecting"),
    state(28, ana.id, bo.id, "connected"),
    state(29, bo.id, ana.id, "connected"),
    state(64, ana.id, cy.id, "connected"),
    state(65, cy.id, ana.id, "connected"),
    {
      at: iso(28),
      kind: "pair_path",
      actorUserId: ana.id,
      targetUserId: bo.id,
      details: { change: "connect", path: "direct" },
    },
    // The flap.
    state(300, ana.id, bo.id, "disconnected"),
    state(302, bo.id, ana.id, "disconnected"),
    state(310, ana.id, bo.id, "connected"),
    state(311, bo.id, ana.id, "connected"),
    {
      at: iso(400),
      kind: "pair_path",
      actorUserId: ana.id,
      targetUserId: bo.id,
      details: {
        change: "change",
        path: "relay",
        local: { type: "relay", protocol: "udp", relayProtocol: "udp" },
      },
    },
    {
      at: iso(REPORT_AT),
      kind: "problem_report",
      actorUserId: bo.id,
      targetUserId: ana.id,
      details: { reportId, category: "frozen", note: "stuck at 8 fps", snapshot: reportId },
    },
    snapshot(
      REPORT_AT + 1,
      ana.id,
      [
        [bo.id, "connected"],
        [cy.id, "connected"],
      ],
      true,
    ),
    snapshot(REPORT_AT + 2, bo.id, [[ana.id, "relayed"]], false),
    { at: iso(600), kind: "leave", actorUserId: cy.id, details: { reason: "left" } },
    { at: iso(900), kind: "leave", actorUserId: ana.id, details: { reason: "left" } },
    { at: iso(900), kind: "leave", actorUserId: bo.id, details: { reason: "left" } },
  ];
  const roomId = await seedRoom(context, {
    name: roomName,
    hostUserId: ana.id,
    createdAt: iso(0),
    endedAt: iso(900),
    presence: [
      { userId: ana.id, startedAt: iso(0), endedAt: iso(900) },
      { userId: bo.id, startedAt: iso(20), endedAt: iso(900) },
      { userId: cy.id, startedAt: iso(60), endedAt: iso(600) },
    ],
    streams: [{ userId: ana.id, startedAt: iso(100), endedAt: iso(140) }],
    events,
  });
  return { roomId, roomName, reportId, ana, bo, cy };
}

/** Sign the admin in (before seeding, as the other specs do). */
async function signInAdmin(context: BrowserContext) {
  await signIn(context, { discordId: E2E_ADMIN_DISCORD_ID, username: "admin_jpg" });
}

async function adminOnDashboard(page: Page) {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
}

/** Open a room's timeline from the recent rooms table. */
async function openFromRecentRooms(page: Page, roomName: string) {
  await page.getByRole("textbox", { name: "Search rooms or hosts" }).fill(roomName);
  await page.getByRole("button", { name: `Timeline of ${roomName}` }).click();
  const section = page.getByRole("region", { name: "room timeline" });
  await expect(section).toBeVisible();
  return section;
}

const width = (rect: import("@playwright/test").Locator) =>
  rect.evaluate((el) => el.getBoundingClientRect().width);

test("an admin opens a room with events and a report, and sees the snapshot table and the swimlanes", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  // The panel is drawn in the browser after a click, so its zone is the browser's and nothing of
  // it is in the server's HTML: a mismatch on hydration would be a page error.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signInAdmin(context);
  const room = await seedTimelineRoom(browser, context);
  await adminOnDashboard(page);
  await expect(page.getByRole("region", { name: "room timeline" })).toHaveCount(0);
  const section = await openFromRecentRooms(page, room.roomName);

  // The room's reports are listed, and its full timeline is the swimlanes.
  const lanes = section.getByTestId("timeline-lanes");
  await expect(lanes).toBeVisible();
  // Times are on the browser's clock, with its zone named, and not UTC's.
  const picker = section.getByRole("button", { name: /(IST|GMT\+5:30) frozen \/ stuttering/ });
  await expect(picker).toBeVisible();
  await expect(picker).toContainText(clock(REPORT_AT));
  const person = (id: string) => lanes.locator(`[data-lane="person:${id}"]`);
  const pairKey = (a: string, b: string) => `pair:${[a, b].sort().join("|")}`;
  await expect(person(room.ana.id)).toContainText(room.ana.username);
  await expect(person(room.bo.id)).toBeVisible();
  await expect(person(room.cy.id)).toBeVisible();
  await expect(lanes.locator(`[data-lane="${pairKey(room.ana.id, room.bo.id)}"]`)).toBeVisible();
  await expect(lanes.locator(`[data-lane="${pairKey(room.ana.id, room.cy.id)}"]`)).toBeVisible();
  // Presence, the share, the mic, and the flap are drawn.
  await expect(lanes.locator('rect[data-track="presence"][data-tone="present"]')).toHaveCount(3);
  await expect(lanes.locator('rect[data-track="share"]')).toHaveCount(1);
  await expect(lanes.locator('rect[data-track="mic"]')).toHaveCount(1);
  await expect(lanes.locator('rect[data-track="state"][data-tone="disconnected"]')).toHaveCount(1);
  await expect(lanes.locator('[data-mark="path"]')).toHaveCount(2);
  // The report is a marker across the lanes.
  await expect(
    lanes.getByRole("button", { name: /open the frozen \/ stuttering report at/ }),
  ).toBeVisible();
  // The same events are in a table, for reading without the chart.
  const table = section.getByRole("table", { name: "events in view" });
  await expect(table).toContainText(`${clock(0)}`);
  await expect(table.getByRole("columnheader", { name: /time \((IST|GMT\+5:30)\)/ })).toBeVisible();
  const readout = section.getByTestId("timeline-view");
  await expect(readout).toContainText(/(IST|GMT\+5:30)/);
  await expect(readout).not.toContainText("UTC");
  await expect(table).toContainText(
    `${room.bo.username} reported frozen / stuttering on ${room.ana.username}'s screen`,
  );
  await expect(table).toContainText(`${room.ana.username} started sharing`);

  // Hovering a bar reads it out: the 40 second share.
  const share = lanes.locator('rect[data-track="share"]');
  await share.scrollIntoViewIfNeeded();
  const box = await share.boundingBox();
  if (!box) throw new Error("the share has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(section.getByTestId("timeline-readout")).toContainText("sharing");
  await expect(section.getByTestId("timeline-readout")).toContainText("(40s)");

  // From the keyboard: all the lanes are one tab stop (a full room has 65), up and down choose a
  // lane and the arrow keys step through what is in it.
  const stop = lanes.getByRole("application", { name: /swimlanes/ });
  await expect(lanes.locator("[data-lane][tabindex]")).toHaveCount(0);
  await stop.focus();
  await page.keyboard.press("ArrowRight");
  await expect(section.getByTestId("timeline-readout")).toContainText(/\d\d:\d\d:\d\d/);
  await page.keyboard.press("ArrowDown");
  await expect(section.getByTestId("timeline-readout")).toContainText(room.bo.username);
  await page.keyboard.press("Escape");

  // Filter chips: by category...
  const connection = section.getByRole("button", { name: /^connection/ });
  await expect(connection).toHaveAttribute("aria-pressed", "true");
  await connection.click();
  await expect(connection).toHaveAttribute("aria-pressed", "false");
  await expect(lanes.locator('[data-lane^="pair:"]')).toHaveCount(0);
  await expect(table).not.toContainText("connection to");
  await connection.click();
  await expect(lanes.locator('[data-lane^="pair:"]')).toHaveCount(2);
  // ...and by person: cy's lane, and the pair lanes cy is in.
  await section.getByRole("button", { name: room.cy.username, exact: true }).click();
  await expect(lanes.locator('[data-lane^="person:"]')).toHaveCount(1);
  await expect(lanes.locator('[data-lane^="pair:"]')).toHaveCount(1);
  await section.getByRole("button", { name: "clear filters" }).click();
  await expect(lanes.locator('[data-lane^="person:"]')).toHaveCount(3);

  // Zoom: the 40 second share is wider once a stretch around it is selected, with a drag.
  const view = section.getByTestId("timeline-view");
  // textContent, not innerText: the label is set in capitals by CSS.
  const fitText = (await view.textContent()) ?? "";
  const fitWidth = await width(share);
  const at = (await share.boundingBox()) ?? box;
  const y = at.y + at.height / 2;
  await page.mouse.move(at.x - 12, y);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width + 12, y, { steps: 8 });
  await page.mouse.up();
  await expect(view).not.toHaveText(fitText);
  expect(await width(share)).toBeGreaterThan(fitWidth * 5);
  // The axis follows: ticks in seconds now.
  await expect(lanes.getByText(/^\d\d:\d\d:\d\d$/).first()).toBeVisible();
  // Reset puts it back; the buttons zoom too.
  await section.getByRole("button", { name: "Reset zoom" }).click();
  await expect(view).toHaveText(fitText);
  await section.getByRole("button", { name: "Zoom in" }).click();
  await expect(view).not.toHaveText(fitText);
  await section.getByRole("button", { name: "Zoom out" }).click();
  await expect(view).toHaveText(fitText);
  // Ctrl and the wheel zoom about the pointer, as the hint says.
  await page.mouse.move(box.x + box.width / 2, y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -500);
  await page.keyboard.up("Control");
  await expect(view).not.toHaveText(fitText);
  await section.getByRole("button", { name: "Reset zoom" }).click();

  // A marker opens the incident: everyone's snapshot first, then two minutes either side. The
  // marker goes with the swimlanes, so focus goes to the section's heading, not to the page.
  const heading = section.getByRole("heading", { name: /room timeline/ });
  await lanes.getByRole("button", { name: /open the frozen \/ stuttering report at/ }).click();
  await expect(heading).toBeFocused();
  const snapshotTable = section.getByRole("table", { name: "snapshot of everyone's connections" });
  await expect(snapshotTable).toBeVisible();
  await expect(section.getByText(`everyone's connections at ${clock(REPORT_AT)}`)).toBeVisible();
  const stream = snapshotTable.getByRole("row").filter({
    hasText: `${room.ana.username} → ${room.bo.username}`,
  });
  // The streamer's word for the step and why, the viewer's for the numbers.
  await expect(stream).toContainText("720p30");
  await expect(stream).toContainText("5.1%");
  await expect(stream).toContainText("120 ms");
  await expect(stream).toContainText("relay · UDP");
  await expect(stream).toContainText("relayed");
  // One row per stream, and the idle pair can be hidden.
  const idle = snapshotTable.getByRole("row").filter({ hasText: "idle" });
  await expect(idle).toHaveCount(1);
  await expect(idle).toContainText(room.cy.username);
  await section.getByRole("button", { name: "hide 1 idle pair" }).click();
  await expect(idle).toHaveCount(0);
  await section.getByRole("button", { name: "show 1 idle pair" }).click();
  await expect(idle).toHaveCount(1);

  const around = section.getByRole("table", { name: "events around the report" });
  await expect(around).toContainText(`${room.bo.username} reported frozen / stuttering`);
  await expect(around).toContainText("report");
  await expect(around).toContainText("connection to");
  // Within two minutes of the report, and no further.
  await expect(around).toContainText("path changed to relay · UDP");
  await expect(around).not.toContainText(`${room.cy.username} joined`);
  await expect(around).not.toContainText("turned their mic on");

  // The quality link opens that pair's quality panel (no samples were seeded for it).
  await stream
    .getByRole("button", { name: `Quality of ${room.ana.username} to ${room.bo.username}` })
    .click();
  const quality = page.getByRole("region", { name: "room quality" });
  await expect(quality).toBeVisible();
  // The section opened far from its button, so focus follows it.
  await expect(quality.getByRole("heading", { name: /video quality/ })).toBeFocused();
  await expect(quality.getByText("no quality samples for that stream")).toBeVisible();

  // And back to the swimlanes.
  await section.getByRole("button", { name: "full timeline" }).click();
  await expect(lanes).toBeVisible();
  await expect(heading).toBeFocused();
  expect(errors).toEqual([]);
});

test("the timeline opens from the live rooms table and from a report, and says when a room has nothing", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  await signInAdmin(context);
  const room = await seedTimelineRoom(browser, context);
  const host = await createUser(browser, uniqueUsername("tl.host"));
  const liveName = uniqueRoomName("timeline live");
  await seedRoom(context, {
    name: liveName,
    hostUserId: host.id,
    createdAt: iso(0),
    presence: [{ userId: host.id, startedAt: iso(0) }],
    streams: [{ userId: host.id, startedAt: iso(300) }],
  });
  const emptyName = uniqueRoomName("timeline empty");
  await seedRoom(context, {
    name: emptyName,
    hostUserId: host.id,
    createdAt: iso(0),
    endedAt: iso(60),
  });
  await adminOnDashboard(page);
  const section = page.getByRole("region", { name: "room timeline" });

  // A live room: its open intervals run to now.
  await page
    .getByRole("table", { name: "live rooms" })
    .getByRole("row")
    .filter({ hasText: liveName })
    .getByRole("button", { name: `Timeline of ${liveName}` })
    .click();
  await expect(section.getByTestId("timeline-lanes")).toBeVisible();
  await expect(
    section.getByTestId("timeline-lanes").locator('rect[data-track="share"]'),
  ).toHaveCount(1);
  await expect(section.getByRole("heading", { name: new RegExp(liveName) })).toBeVisible();
  await expect(section.getByRole("button", { name: /frozen/ })).toHaveCount(0);

  // A room with nothing recorded.
  await page.getByRole("textbox", { name: "Search rooms or hosts" }).fill(emptyName);
  await page.getByRole("button", { name: `Timeline of ${emptyName}` }).click();
  await expect(section.getByText(/nothing recorded for this room/)).toBeVisible();

  // The recent reports list opens the incident, not the swimlanes.
  await page
    .getByRole("table", { name: "recent reports" })
    .getByRole("row")
    .filter({ hasText: room.roomName })
    .getByRole("button", { name: `Incident in ${room.roomName}` })
    .click();
  await expect(
    section.getByRole("table", { name: "snapshot of everyone's connections" }),
  ).toBeVisible();
  await expect(section.getByRole("table", { name: "events around the report" })).toBeVisible();
  // Opened from a button far above: the section's heading has focus.
  await expect(section.getByRole("heading", { name: new RegExp(room.roomName) })).toBeFocused();
  await expect(section.getByTestId("timeline-lanes")).toHaveCount(0);
  await expect(section.getByRole("heading", { name: new RegExp(room.roomName) })).toBeVisible();
  await section.getByRole("button", { name: "close" }).click();
  await expect(section).toHaveCount(0);
});

test("a room with more entries than the read allows says it shows the latest", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  await signInAdmin(context);
  const host = await createUser(browser, uniqueUsername("tl.busy"));
  const roomName = uniqueRoomName("timeline busy");
  await seedRoom(context, {
    name: roomName,
    hostUserId: host.id,
    createdAt: iso(0),
    endedAt: iso(6_000),
    presence: [{ userId: host.id, startedAt: iso(0), endedAt: iso(6_000) }],
    // Past the 5,000 the read returns (MAX_TIMELINE_ENTRIES).
    events: Array.from({ length: 5_010 }, (_, i) => ({
      at: iso(i),
      kind: "rename" as const,
      actorUserId: host.id,
      details: { from: `old ${i}`, to: `new ${i}` },
    })),
  });
  await adminOnDashboard(page);
  const section = await openFromRecentRooms(page, roomName);
  await expect(section.getByText(/showing the latest 5,000 entries/)).toBeVisible();
  // About 5,000 marks on one lane are drawn as a few dozen, one for each pixel column, with the
  // number each holds; zooming (here by the wheel, timed) redraws them quickly.
  const lanes = section.getByTestId("timeline-lanes");
  const marks = lanes.locator("[data-mark]");
  await expect(marks.first()).toBeVisible();
  expect(await marks.count()).toBeLessThan(200);
  const held = await marks.evaluateAll((els) =>
    els.reduce((sum, el) => sum + Number(el.getAttribute("data-count")), 0),
  );
  expect(held).toBeGreaterThan(2_000);
  // The table draws a bounded number of rows, however many are in view.
  await expect(section.getByRole("table", { name: "events in view" }).getByRole("row")).toHaveCount(
    501,
  );
  await expect(section.getByText(/the first 500 shown/)).toBeVisible();
  // Zooming with the wheel redraws them quickly.
  const view = section.getByTestId("timeline-view");
  const before = (await view.textContent()) ?? "";
  await lanes.scrollIntoViewIfNeeded();
  const box = await lanes.boundingBox();
  if (!box) throw new Error("no lanes");
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(120, box.height / 2));
  const began = Date.now();
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect(view).not.toHaveText(before);
  expect(Date.now() - began).toBeLessThan(5_000);
});
