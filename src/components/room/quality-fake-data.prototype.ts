// PROTOTYPE (ticket #93): fake quality data for the quality-modal variants. Throwaway.
// A pure function of the tick (seconds), so every variant shows the same plausible numbers and
// a screenshot is reproducible. Nothing here talks to the real mesh.
import { useEffect, useState } from "react";

/** Why a pair sits at its current step, in the five plain-language buckets from the ticket. */
export type Why = "best" | "shared" | "connection" | "computer" | "starting";

export const WHY: Record<
  Why,
  { label: string; tone: "ok" | "caution" | ""; sentence: (you: boolean) => string }
> = {
  best: {
    label: "Best quality",
    tone: "ok",
    sentence: () => "At the top step this screen allows.",
  },
  shared: {
    label: "Streamer's upload is shared",
    tone: "caution",
    sentence: () =>
      "Held by the streamer's upload budget, or by this viewer's fair share of it. More viewers means a thinner slice each.",
  },
  connection: {
    label: "The connection between you",
    tone: "caution",
    sentence: (you) =>
      `${you ? "This pair" : "This pair"} showed loss, a long round trip or a bandwidth limit. It may be either end or the route between them; it is not a fault of the viewer.`,
  },
  computer: {
    label: "Streamer's computer",
    tone: "caution",
    sentence: () => "The streamer's encoder is CPU-limited.",
  },
  starting: {
    label: "Getting started / trying higher",
    tone: "",
    sentence: () => "This pair is ramping up, or briefly probing a higher step.",
  },
};

export type Step = { w: number; h: number; fps: number };

/** Bits per pixel per frame: 3 Mbps for 1920x1080@30 (ANCHOR_BITRATE in src/lib/quality.ts). */
const BPP = 3_000_000 / (1920 * 1080 * 30);
export const capOf = (s: Step) => s.w * s.h * s.fps * BPP;
export const stepLabel = (s: Step) => `${s.w}×${s.h}@${s.fps}`;
export const mbps = (bps: number, digits = 2) => `${(bps / 1e6).toFixed(digits)} Mbps`;

const S = (w: number, h: number, fps: number): Step => ({ w, h, fps });

/** A step change; `at` is a tick (seconds), negative for before the modal's first tick. */
export type Change = { at: number; step: Step; why: Why };

type PairDef = {
  /** Their display name (the viewer, in the streamer's view). */
  name: string;
  path: { kind: "direct" } | { kind: "relay"; proto: "UDP" | "TCP" | "TLS" };
  codec: string;
  /** Loss in percent: [mean, swing]. */
  loss: [number, number];
  rtt: [number, number];
  /** Share of the cap the encoder actually fills. */
  fill: number;
  freezes: number;
  changes: Change[];
};

const KIRA: PairDef = {
  name: "kira",
  path: { kind: "direct" },
  codec: "VP9",
  loss: [0.05, 0.08],
  rtt: [18, 5],
  fill: 0.93,
  freezes: 0,
  changes: [
    { at: -170, step: S(742, 311, 30), why: "starting" },
    { at: -150, step: S(1484, 622, 30), why: "starting" },
    { at: -128, step: S(2226, 932, 30), why: "starting" },
    { at: -100, step: S(2226, 932, 60), why: "starting" },
    { at: -64, step: S(2968, 1242, 60), why: "best" },
    { at: -37, step: S(2226, 932, 60), why: "connection" },
    { at: -29, step: S(2968, 1242, 60), why: "starting" },
    { at: -22, step: S(2968, 1242, 60), why: "best" },
  ],
};

const MO: PairDef = {
  name: "mo",
  path: { kind: "relay", proto: "UDP" },
  codec: "VP9",
  loss: [3, 1],
  rtt: [142, 22],
  fill: 0.88,
  freezes: 2,
  changes: [
    { at: -150, step: S(742, 311, 30), why: "starting" },
    { at: -141, step: S(1113, 466, 30), why: "starting" },
    { at: -126, step: S(1484, 622, 30), why: "starting" },
    { at: -92, step: S(2226, 932, 30), why: "starting" },
    { at: -83, step: S(1484, 622, 30), why: "connection" },
    { at: -31, step: S(2226, 932, 30), why: "starting" },
    { at: -24, step: S(1484, 622, 30), why: "connection" },
  ],
};

const JULES: PairDef = {
  name: "jules",
  path: { kind: "direct" },
  codec: "H.264",
  loss: [0.1, 0.1],
  rtt: [24, 6],
  fill: 0.94,
  freezes: 0,
  changes: [
    { at: -120, step: S(1484, 622, 30), why: "starting" },
    { at: -105, step: S(2226, 932, 60), why: "starting" },
    { at: -90, step: S(2968, 1242, 60), why: "starting" },
    { at: -81, step: S(2226, 932, 60), why: "shared" },
  ],
};

/** Cheap deterministic noise in [-1, 1]. */
const noise = (t: number, seed: number) =>
  Math.sin(t * 12.9898 + seed * 78.233) * 0.5 + Math.sin(t * 3.1 + seed) * 0.5;

const stepAt = (def: PairDef, t: number): Change => {
  let cur = def.changes[0] as Change;
  for (const c of def.changes) if (c.at <= t) cur = c;
  return cur;
};

export type Sample = { t: number; bps: number; h: number; capBps: number };

export type Pair = {
  id: string;
  name: string;
  step: Step;
  capBps: number;
  why: Why;
  /** Bits per second the streamer's encoder sends this viewer. */
  sentBps: number;
  recv: { w: number; h: number; fps: number; bps: number; codec: string };
  path: PairDef["path"];
  lossPct: number;
  rttMs: number;
  freezes: number;
  /** The last 60 s, oldest first. */
  history: Sample[];
  /** Step changes in the last 3 minutes, newest first. */
  events: (Change & { prev: Step | null; ageS: number })[];
};

const sampleAt = (def: PairDef, t: number, seed: number): Sample => {
  const { step, why } = stepAt(def, t);
  const cap = capOf(step);
  const ramp = why === "starting" ? 0.78 : 1;
  const bps = cap * def.fill * ramp * (1 + noise(t, seed) * 0.06);
  return { t, bps, h: step.h, capBps: cap };
};

export const pairAt = (def: PairDef, tick: number, seed: number): Pair => {
  const now = stepAt(def, tick);
  const cur = sampleAt(def, tick, seed);
  const history = Array.from({ length: 60 }, (_, i) => sampleAt(def, tick - 59 + i, seed));
  const loss = Math.max(0, def.loss[0] + noise(tick, seed + 1) * def.loss[1]);
  const events = def.changes
    .map((c, i) => ({ ...c, prev: def.changes[i - 1]?.step ?? null, ageS: tick - c.at }))
    .filter((c) => c.ageS >= 0 && c.ageS <= 180)
    .reverse();
  return {
    id: def.name,
    name: def.name,
    step: now.step,
    capBps: cur.capBps,
    why: now.why,
    sentBps: cur.bps,
    recv: {
      w: now.step.w,
      h: now.step.h,
      fps: Math.round(now.step.fps - Math.abs(noise(tick, seed + 2)) * (def.loss[0] > 1 ? 3 : 1)),
      bps: cur.bps * (1 - loss / 100),
      codec: def.codec,
    },
    path: def.path,
    lossPct: loss,
    rttMs: Math.round(def.rtt[0] + noise(tick, seed + 3) * def.rtt[1]),
    freezes: def.freezes,
    history,
    events,
  };
};

export type Scenario = 1 | 2 | 3 | 4;

export const SCENARIOS: Record<Scenario, string> = {
  1: "viewer, direct, best",
  2: "viewer, relay, connection",
  3: "viewer, upload shared",
  4: "streamer, 3 viewers",
};

export type Snapshot = {
  role: "viewer" | "streamer";
  /** Whose share this is. */
  streamer: string;
  /** Viewer: just your own pair. Streamer: every viewer's. */
  pairs: Pair[];
  /** The streamer's measured upload and the budget drawn from it (streamer view only). */
  upload: { measuredBps: number; budgetBps: number };
};

export const snapshotAt = (scenario: Scenario, tick: number): Snapshot => {
  const upload = (tick: number) => {
    const measuredBps = 21_000_000 * (1 + noise(tick, 9) * 0.02);
    return { measuredBps, budgetBps: measuredBps * 0.9 };
  };
  if (scenario === 4) {
    return {
      role: "streamer",
      streamer: "you",
      pairs: [pairAt(KIRA, tick, 1), pairAt(MO, tick, 2), pairAt(JULES, tick, 3)],
      upload: upload(tick),
    };
  }
  const def = scenario === 1 ? KIRA : scenario === 2 ? MO : JULES;
  // Viewer view: the pair is named for the streamer, "you" being the viewer.
  const pair = pairAt(def, tick, scenario);
  return {
    role: "viewer",
    streamer: "kira",
    pairs: [{ ...pair, id: "you", name: "you" }],
    upload: upload(tick),
  };
};

/** Ticks every second; the data stands in for the real feed (about every 1-2 s in production). */
export function useFakeQuality(scenario: Scenario): Snapshot {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  return snapshotAt(scenario, tick);
}

export const pathLabel = (path: Pair["path"]) =>
  path.kind === "direct" ? "direct" : `relay · ${path.proto}`;

/**
 * The link holding a pair back, for the pipeline variant: the streamer's upload, the
 * connection, or the streamer's computer. Null when nothing is.
 */
export const limitingLink = (why: Why): "streamer" | "connection" | "upload" | null =>
  why === "connection"
    ? "connection"
    : why === "shared"
      ? "upload"
      : why === "computer"
        ? "streamer"
        : null;
