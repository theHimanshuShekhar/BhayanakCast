// PROTOTYPE (#114), throwaway: an in-memory room timeline, modelled on the 10 October room
// "Pojo Kun and munmun" (watch room, 22:31-22:45 IST). No DB; nothing here is real data.
//
// Times are seconds after 22:00:00 IST, written `at("35:04")` = 22:35:04.

export const at = (mmss: string) => {
  const [m = 0, s = 0] = mmss.split(":").map(Number);
  return m * 60 + s;
};
export const fmtClock = (t: number) =>
  `22:${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export type Cat = "presence" | "moderation" | "media" | "connection" | "refusals" | "reports";
export const CATS: { key: Cat; label: string }[] = [
  { key: "presence", label: "presence" },
  { key: "moderation", label: "moderation" },
  { key: "media", label: "media" },
  { key: "connection", label: "connection" },
  { key: "refusals", label: "refusals" },
  { key: "reports", label: "reports" },
];

export interface Person {
  id: string;
  name: string;
}
export const PEOPLE: Person[] = [
  { id: "kinzaatu", name: "Kinzaatu" },
  { id: "rakabaka", name: "RAKABAKA" },
  { id: "danee", name: "Danee" },
  { id: "thybumbum", name: "ThyBumbum" },
  { id: "goti", name: "Goti" },
];
export const nameOf = (id: string) => PEOPLE.find((p) => p.id === id)?.name ?? id;

export const ROOM = {
  name: "Pojo Kun and munmun",
  kind: "watch",
  from: at("31:00"),
  to: at("45:30"),
};

export interface Span {
  who: string;
  from: number;
  to: number;
}
const span = (who: string, from: string, to: string): Span => ({
  who,
  from: at(from),
  to: at(to),
});

const PRESENCE: Span[] = [
  span("kinzaatu", "31:02", "39:12"),
  span("rakabaka", "31:08", "37:39"),
  span("rakabaka", "38:31", "41:10"), // ended by a takeover
  span("rakabaka", "41:10", "45:12"),
  span("danee", "31:40", "37:41"),
  span("thybumbum", "32:09", "37:40"),
  span("thybumbum", "38:44", "43:35"), // grace expired
  span("goti", "33:12", "45:20"),
];
const HOST: Span[] = [span("kinzaatu", "31:02", "39:05"), span("goti", "39:05", "45:20")];
const SHARES: (Span & { endedBy?: string })[] = [
  span("kinzaatu", "35:04", "35:56"),
  span("danee", "35:30", "36:19"),
  { ...span("rakabaka", "36:34", "37:14"), endedBy: "goti" },
  span("danee", "36:50", "37:41"),
];
const CAMS: Span[] = [span("rakabaka", "32:20", "34:00"), span("goti", "34:10", "36:00")];
const MICS: Span[] = [
  span("kinzaatu", "31:50", "33:02"),
  span("kinzaatu", "33:48", "39:00"),
  span("danee", "31:52", "37:41"),
  span("thybumbum", "32:41", "37:40"),
  span("rakabaka", "31:10", "37:39"),
  span("rakabaka", "38:40", "45:12"),
  span("goti", "33:30", "44:00"),
];
/** Spans where a person's socket was down and the 30s reconnect grace held their place. */
const GRACE: Span[] = [span("danee", "33:44", "33:57"), span("thybumbum", "43:05", "43:35")];
export const SPANS = {
  presence: PRESENCE,
  grace: GRACE,
  host: HOST,
  shares: SHARES,
  cams: CAMS,
  mics: MICS,
};

export interface Pair {
  id: string;
  a: string;
  b: string;
}
export const pairId = (x: string, y: string) => {
  const order = PEOPLE.map((p) => p.id);
  return order.indexOf(x) < order.indexOf(y) ? `${x}-${y}` : `${y}-${x}`;
};
export const PAIRS: Pair[] = PEOPLE.flatMap((a, i) =>
  PEOPLE.slice(i + 1).map((b) => ({ id: pairId(a.id, b.id), a: a.id, b: b.id })),
);

export type PairState = "connecting" | "connected" | "disconnected";
export interface PairSeg {
  pair: string;
  from: number;
  to: number;
  state: PairState;
}
export interface Path {
  kind: "direct" | "relay";
  proto: "udp" | "tcp" | "tls";
}
export const pathText = (p: Path) =>
  p.kind === "direct"
    ? `direct · ${p.proto.toUpperCase()}`
    : `relay · TURN ${p.proto.toUpperCase()}`;

/** Windows when a pair is down (a flap, or a person's socket dropping). */
const FLAPS: { pair: string; from: string; to: string; how: "ice" | "new" }[] = [
  { pair: "rakabaka-goti", from: "36:40", to: "36:46", how: "ice" },
  { pair: "rakabaka-goti", from: "36:52", to: "37:00", how: "ice" },
  { pair: "rakabaka-goti", from: "37:06", to: "37:10", how: "ice" },
  // Danee's socket dropped for 13s: each of her pairs went down and came back.
  { pair: "kinzaatu-danee", from: "33:44", to: "33:57", how: "new" },
  { pair: "rakabaka-danee", from: "33:44", to: "33:57", how: "new" },
  { pair: "danee-thybumbum", from: "33:44", to: "33:57", how: "new" },
  { pair: "danee-goti", from: "33:44", to: "33:57", how: "new" },
];
/** A negotiation that failed and was started over. */
const NEGOTIATION = { pair: "kinzaatu-thybumbum", t: at("34:47"), back: at("34:50") };
const PATH_AT_CONNECT: Record<string, Path> = {
  "danee-thybumbum": { kind: "relay", proto: "udp" },
};
const DIRECT: Path = { kind: "direct", proto: "udp" };
const PATH_CHANGES = [
  {
    pair: "rakabaka-goti",
    t: at("37:10"),
    to: { kind: "relay", proto: "tls" } as Path,
    from: DIRECT,
  },
];
export const pathAt = (pair: string, t: number): Path => {
  const change = PATH_CHANGES.filter((c) => c.pair === pair && c.t <= t).at(-1);
  return change?.to ?? PATH_AT_CONNECT[pair] ?? DIRECT;
};

/** The pair's connection over its life: connecting, connected, then down where a flap says so. */
function buildPairSegs(): PairSeg[] {
  const segs: PairSeg[] = [];
  for (const pair of PAIRS) {
    for (const x of PRESENCE.filter((s) => s.who === pair.a)) {
      for (const y of PRESENCE.filter((s) => s.who === pair.b)) {
        const from = Math.max(x.from, y.from);
        const to = Math.min(x.to, y.to);
        if (to <= from) continue;
        const cuts: [number, number, PairState][] = [
          ...FLAPS.filter((f) => f.pair === pair.id).map((f): [number, number, PairState] => [
            at(f.from),
            at(f.to),
            "disconnected",
          ]),
          ...(NEGOTIATION.pair === pair.id
            ? [[NEGOTIATION.t, NEGOTIATION.back, "connecting"] as [number, number, PairState]]
            : []),
        ]
          .filter(([f, t]) => f >= from && t <= to)
          .sort((p, q) => p[0] - q[0]);
        let cursor = from + 2;
        segs.push({ pair: pair.id, from, to: cursor, state: "connecting" });
        for (const [f, t, state] of cuts) {
          segs.push({ pair: pair.id, from: cursor, to: f, state: "connected" });
          segs.push({ pair: pair.id, from: f, to: t, state });
          cursor = t;
        }
        segs.push({ pair: pair.id, from: cursor, to, state: "connected" });
      }
    }
  }
  return segs;
}
export const PAIR_SEGS = buildPairSegs();
export const pairStateAt = (pair: string, t: number): PairState | null =>
  PAIR_SEGS.find((s) => s.pair === pair && s.from <= t && t < s.to)?.state ?? null;

export interface StepChange {
  streamer: string;
  viewer: string;
  t: number;
  from: string;
  to: string;
  reason: string;
}
const step = (
  streamer: string,
  viewer: string,
  mmss: string,
  from: string,
  to: string,
  reason: string,
): StepChange => ({ streamer, viewer, t: at(mmss), from, to, reason });
export const STEPS: StepChange[] = [
  step("danee", "thybumbum", "35:41", "1080p30", "720p30", "loss"),
  step("danee", "thybumbum", "35:47", "720p30", "480p30", "bandwidth"),
  step("danee", "goti", "36:03", "1080p30", "720p30", "bandwidth"),
  step("danee", "thybumbum", "36:08", "480p30", "720p30", "recovered"),
  step("rakabaka", "goti", "36:41", "1080p30", "480p30", "loss"),
  step("rakabaka", "goti", "37:02", "480p30", "720p30", "recovered"),
];
const stepAt = (streamer: string, viewer: string, t: number) =>
  STEPS.filter((s) => s.streamer === streamer && s.viewer === viewer && s.t <= t).at(-1);

export interface TlEvent {
  id: number;
  t: number;
  cat: Cat;
  /** The short tag: join, share, state, path ... */
  kind: string;
  tone: "" | "ok" | "caution" | "live" | "accent";
  who: string;
  peer?: string;
  pair?: string;
  text: string;
  detail?: string;
  /** A refusal summary covers its whole minute: shown as 22:34 rather than a second. */
  minute?: boolean;
  report?: string;
}

export interface SnapRow {
  from: string;
  to: string;
  /** Null for a pair nobody is streaming over. */
  slot: "screen" | "cam" | null;
  step: string | null;
  kbps: number | null;
  res: string | null;
  fps: number | null;
  loss: number | null;
  rttMs: number | null;
  path: Path;
  reason: string | null;
  state: PairState;
}
export interface Report {
  id: string;
  t: number;
  by: string;
  category: "blurry" | "frozen" | "no audio" | "can't connect";
  note?: string;
  rows: SnapRow[];
}

const RES: Record<string, [string, number]> = {
  "1080p30": ["1920×1080", 4600],
  "720p30": ["1280×720", 2400],
  "480p30": ["854×480", 900],
};

/** Everyone's connections at `t`, as each browser would report them with a problem report. */
function snapshotAt(t: number, tweak: Record<string, Partial<SnapRow>>): SnapRow[] {
  const here = PEOPLE.filter((p) =>
    PRESENCE.some((s) => s.who === p.id && s.from <= t && t < s.to),
  );
  const sharing = SHARES.filter((s) => s.from <= t && t < s.to);
  const rows: SnapRow[] = [];
  here.forEach((x, i) => {
    for (const y of here.slice(i + 1)) {
      const id = pairId(x.id, y.id);
      const base = { path: pathAt(id, t), state: pairStateAt(id, t) ?? "connected" } as const;
      const streams = sharing.filter((s) => s.who === x.id || s.who === y.id);
      if (streams.length === 0) {
        rows.push({
          from: x.id,
          to: y.id,
          slot: null,
          step: null,
          kbps: null,
          res: null,
          fps: null,
          loss: null,
          rttMs: null,
          path: base.path,
          reason: null,
          state: base.state,
        });
        continue;
      }
      for (const s of streams) {
        const from = s.who;
        const to = s.who === x.id ? y.id : x.id;
        const change = stepAt(from, to, t);
        const rung = change?.to ?? "1080p30";
        const [res, kbps] = RES[rung] ?? ["—", 0];
        const relay = base.path.kind === "relay";
        rows.push({
          from,
          to,
          slot: "screen",
          step: rung,
          kbps: kbps + ((from.length * 37 + to.length * 91) % 300) - 150,
          res,
          fps: 30,
          loss: 0.1 + ((from.length + to.length) % 3) / 10,
          rttMs: relay ? 142 : 18 + ((from.length * 7 + to.length * 13) % 40),
          path: base.path,
          reason: change?.reason ?? null,
          state: base.state,
          ...tweak[`${from}>${to}`],
        });
      }
    }
  });
  return rows;
}

const REPORTS: Omit<Report, "rows">[] = [
  {
    id: "r1",
    t: at("35:52"),
    by: "thybumbum",
    category: "blurry",
    note: "Danee's screen looks soft",
  },
  { id: "r2", t: at("36:56"), by: "goti", category: "frozen" },
];
const SNAP_TWEAKS: Record<string, Record<string, Partial<SnapRow>>> = {
  r1: { "danee>thybumbum": { kbps: 410, fps: 14, loss: 4.2, rttMs: 188 } },
  r2: { "rakabaka>goti": { kbps: 0, fps: 0, loss: 31, rttMs: null } },
};
export const REPORT_LIST: Report[] = REPORTS.map((r) => ({
  ...r,
  rows: snapshotAt(r.t, SNAP_TWEAKS[r.id] ?? {}),
}));

type Draft = Omit<TlEvent, "id" | "tone"> & { tone?: TlEvent["tone"] };

function buildEvents(): TlEvent[] {
  const out: Draft[] = [];
  const add = (
    t: number | string,
    cat: Cat,
    kind: string,
    who: string,
    text: string,
    extra: Partial<Draft> = {},
  ) => out.push({ t: typeof t === "string" ? at(t) : t, cat, kind, who, text, ...extra });

  // Presence, from the intervals.
  const firstOf = (s: Span) => PRESENCE.filter((p) => p.who === s.who)[0] === s;
  for (const s of PRESENCE) {
    add(s.from, "presence", "join", s.who, firstOf(s) ? "joined" : "joined again", { tone: "ok" });
  }
  add("39:12", "presence", "leave", "kinzaatu", "left");
  add("37:39", "presence", "leave", "rakabaka", "left");
  add("37:40", "presence", "leave", "thybumbum", "left");
  add("37:41", "presence", "leave", "danee", "left");
  add("41:10", "presence", "takeover", "rakabaka", "opened a new tab: the old connection ended", {
    tone: "caution",
  });
  add("45:12", "presence", "leave", "rakabaka", "removed from the room", { tone: "caution" });
  add("45:20", "presence", "leave", "goti", "left");
  add("33:44", "presence", "disconnect", "danee", "socket disconnected", { tone: "caution" });
  add("33:44", "presence", "grace", "danee", "reconnect grace started (30s)");
  add("33:57", "presence", "resume", "danee", "reconnected inside the grace", { tone: "ok" });
  add("43:05", "presence", "disconnect", "thybumbum", "socket disconnected", { tone: "caution" });
  add("43:05", "presence", "grace", "thybumbum", "reconnect grace started (30s)");
  add("43:35", "presence", "grace", "thybumbum", "grace expired: counted as left", {
    tone: "caution",
  });

  // Room and moderation.
  add("32:30", "moderation", "rename", "kinzaatu", "renamed the room", {
    detail: "Pojo Kun & munmun → Pojo Kun and munmun",
  });
  add("33:40", "moderation", "role", "kinzaatu", "made Goti a mod", { peer: "goti" });
  add("37:14", "moderation", "mod", "goti", "stopped RAKABAKA's share", { peer: "rakabaka" });
  add("39:05", "moderation", "host", "kinzaatu", "passed host to Goti", {
    peer: "goti",
    tone: "accent",
  });
  add("41:35", "moderation", "knock", "pixelmoth", "knocked to join", { tone: "accent" });
  add("41:47", "moderation", "knock", "goti", "denied pixelmoth's knock", { peer: "pixelmoth" });
  add("42:10", "moderation", "knock", "nightowl", "knocked to join", { tone: "accent" });
  add("42:19", "moderation", "knock", "nightowl", "cancelled their knock");
  add("45:12", "moderation", "kick", "goti", "removed RAKABAKA from the room", {
    peer: "rakabaka",
  });
  add("45:16", "moderation", "ban", "admin_jpg", "banned RAKABAKA for 1h", {
    peer: "rakabaka",
    detail: "reason: spamming signals",
    tone: "live",
  });
  add("45:21", "moderation", "end", "admin_jpg", "ended the room", { tone: "caution" });

  // Media: shares, cameras, microphones.
  for (const s of SHARES) {
    add(s.from, "media", "share", s.who, "started sharing", { tone: "live" });
    add(
      s.to,
      "media",
      "share",
      s.endedBy ?? s.who,
      s.endedBy ? "share stopped by a mod" : "stopped sharing",
      { peer: s.endedBy ? s.who : undefined },
    );
  }
  for (const c of CAMS) {
    add(c.from, "media", "cam", c.who, "camera on");
    add(c.to, "media", "cam", c.who, "camera off");
  }
  for (const m of MICS) {
    add(m.from, "media", "mic", m.who, "mic on");
    add(m.to, "media", "mic", m.who, "mic off");
  }
  add("32:02", "media", "error", "thybumbum", "NotAllowedError · Permission denied", {
    detail: "device: mic · in the lobby, before joining",
    tone: "caution",
  });
  add("41:30", "media", "error", "rakabaka", "NotAllowedError · play() blocked by autoplay", {
    detail: "playback: audio of Goti",
    tone: "caution",
  });

  // Connections: each pair's path at connect, flaps, a failed negotiation, step changes.
  for (const pair of PAIRS) {
    for (const x of PRESENCE.filter((s) => s.who === pair.a)) {
      for (const y of PRESENCE.filter((s) => s.who === pair.b)) {
        const from = Math.max(x.from, y.from);
        if (Math.min(x.to, y.to) <= from) continue;
        const joiner = x.from >= y.from ? pair.a : pair.b;
        const other = joiner === pair.a ? pair.b : pair.a;
        const path = pathAt(pair.id, from + 2);
        add(from + 2, "connection", "state", joiner, "connected", {
          peer: other,
          pair: pair.id,
          tone: "ok",
          detail: pathText(path),
        });
      }
    }
  }
  for (const f of FLAPS) {
    const [a = "", b = ""] = f.pair.split("-");
    add(f.from, "connection", "state", a, "disconnected", {
      peer: b,
      pair: f.pair,
      tone: "caution",
    });
    add(
      f.to,
      "connection",
      "state",
      a,
      f.how === "ice" ? "connected after an ICE restart" : "connected on a new connection",
      {
        peer: b,
        pair: f.pair,
        tone: "ok",
      },
    );
  }
  add(NEGOTIATION.t, "connection", "error", "kinzaatu", "negotiation error: InvalidStateError", {
    peer: "thybumbum",
    pair: NEGOTIATION.pair,
    tone: "caution",
    detail: "setRemoteDescription called in state stable",
  });
  add(NEGOTIATION.t + 1, "connection", "state", "kinzaatu", "started over", {
    peer: "thybumbum",
    pair: NEGOTIATION.pair,
  });
  add(NEGOTIATION.back, "connection", "state", "kinzaatu", "connected", {
    peer: "thybumbum",
    pair: NEGOTIATION.pair,
    tone: "ok",
  });
  for (const c of PATH_CHANGES) {
    const [a = "", b = ""] = c.pair.split("-");
    add(c.t, "connection", "path", a, `path changed ${pathText(c.from)} → ${pathText(c.to)}`, {
      peer: b,
      pair: c.pair,
      tone: "caution",
    });
  }
  for (const s of STEPS) {
    add(
      s.t,
      "connection",
      "step",
      s.streamer,
      `${nameOf(s.streamer)} → ${nameOf(s.viewer)}: ${s.from} → ${s.to}`,
      {
        peer: s.viewer,
        pair: pairId(s.streamer, s.viewer),
        detail: `quality step · ${s.reason}`,
      },
    );
  }

  // Refusals, one line per person per minute and type.
  add("34:00", "refusals", "refused", "thybumbum", "signal rate_limited ×4", { minute: true });
  add("33:00", "refusals", "refused", "goti", "signal bad_payload ×1", { minute: true });
  add("36:00", "refusals", "refused", "danee", "chat rate_limited ×2", { minute: true });

  for (const r of REPORT_LIST) {
    add(r.t, "reports", "report", r.by, `reported a problem: ${r.category}`, {
      detail: r.note,
      tone: "caution",
      report: r.id,
    });
  }

  return out.sort((p, q) => p.t - q.t).map((e, i) => ({ ...e, id: i, tone: e.tone ?? "" }));
}
export const EVENTS = buildEvents();
