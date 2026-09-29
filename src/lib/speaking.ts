/**
 * Who is speaking, measured locally (spec #4): each received mic track's level (and this page's
 * own mic's) from ./audio-level.ts, with a short hold so words don't flicker. Nothing about
 * speaking goes over the socket.
 */
import { watchAudioLevel } from "./audio-level";

/** Level (`levelOf`'s 0–1 scale) at or above which a frame counts as speech: about -36 dBFS. */
export const SPEAKING_LEVEL = 0.4;
/** How long someone still counts as speaking after their last loud frame. */
export const SPEAKING_HOLD_MS = 400;

export interface SpeakingState {
  speaking: boolean;
  /** When (ms) the last loud frame was heard; -Infinity if never. */
  lastLoudAt: number;
}

export const SILENT: SpeakingState = { speaking: false, lastLoudAt: Number.NEGATIVE_INFINITY };

/** The speaking state after hearing a frame at `level` (0–1, `levelOf`) at `now` (ms). */
export function hear(state: SpeakingState, level: number, now: number): SpeakingState {
  const lastLoudAt = level >= SPEAKING_LEVEL ? now : state.lastLoudAt;
  return { speaking: now - lastLoudAt < SPEAKING_HOLD_MS, lastLoudAt };
}

/**
 * A deliberate page-wide singleton: one AudioContext shared by every speaking analyser (not one
 * per track), unlocked once by a user gesture, and its resume listeners live for the page's
 * lifetime and are never closed or removed. Leaving a room only disconnects the analysers
 * (`watchSpeaking`).
 */
let context: AudioContext | null = null;

/**
 * The page's one AudioContext for speaking detection, created on first call. Browsers can keep
 * it suspended until the user interacts with the page (Firefox until a click after it's
 * created), so it resumes on any click or key press while it isn't running.
 */
export function speakingContext(): AudioContext {
  if (context) return context;
  const ctx = new AudioContext();
  context = ctx;
  const resume = () => {
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", resume, true);
  window.addEventListener("keydown", resume, true);
  resume();
  return ctx;
}

/**
 * Call `onChange` whenever `track`'s speaker starts or stops speaking. Returns a function that
 * stops listening (it never stops `track`). Chromium only feeds a received track to WebAudio
 * while it also plays in a media element: the room's `<audio>` elements do that.
 */
export function watchSpeaking(
  track: MediaStreamTrack,
  onChange: (speaking: boolean) => void,
): () => void {
  let state = SILENT;
  const stop = watchAudioLevel(
    track,
    (level) => {
      const next = hear(state, level, performance.now());
      if (next.speaking !== state.speaking) onChange(next.speaking);
      state = next;
    },
    speakingContext(),
  );
  return () => {
    stop();
    if (state.speaking) onChange(false);
  };
}
