/**
 * This browser's own mic and camera: which devices there are, which one the user picked, and
 * the live `MediaStreamTrack` for each while it's on. The lobby (`CONTEXT.md`) picks and
 * previews devices with it, and the room's controls and the mesh (ADR 1) read the same tracks:
 * `getLocalMedia()` is the page's one `LocalMedia`, and `useLocalMedia()` follows its state.
 *
 * - Both start off. Permission is asked for lazily: `enable` calls `getUserMedia` for that
 *   device only, the first time it's turned on (a denied prompt leaves it `denied`).
 * - The chosen device ids are remembered in localStorage; whether each was on never is.
 * - Choosing another device while one is on swaps its track (a new `MediaStreamTrack` object),
 *   so consumers follow `track` identity, e.g. `RTCRtpSender.replaceTrack` on change.
 * - `release()` stops every track (leaving the room, taken over, kicked): the camera light
 *   goes off.
 *
 * Browser-only: call it from effects and event handlers, never during render.
 */
import { useSyncExternalStore } from "react";

export type LocalDeviceKind = "mic" | "cam";

export interface LocalDevice {
  /** The browser's `deviceId`, stable for this site. */
  id: string;
  label: string;
}

/**
 * `off` until turned on, `starting` while `getUserMedia` runs, `on` with a live track. A failed
 * start is `off` again, with its `failure` saying why.
 */
export type LocalTrackStatus = "off" | "starting" | "on";

/**
 * Why the last `enable` failed: the user or browser `denied` access, there's no such device
 * (`missing`), it's in use elsewhere or broken (`busy`), or this browser/page can't capture
 * at all (`unsupported`, e.g. not a secure context).
 */
export type LocalTrackFailure = "denied" | "missing" | "busy" | "unsupported";

export interface LocalTrackState {
  status: LocalTrackStatus;
  /** Live while `on`, else null. */
  track: MediaStreamTrack | null;
  /** Set when the last attempt to turn it on failed; cleared by the next attempt. */
  failure: LocalTrackFailure | null;
}

export interface LocalMediaState {
  /** Devices of each kind, as `enumerateDevices` lists them (labels once permission is given). */
  devices: Record<LocalDeviceKind, LocalDevice[]>;
  /** The chosen device of each kind, or null for the browser's default. Remembered locally. */
  selected: Record<LocalDeviceKind, string | null>;
  mic: LocalTrackState;
  cam: LocalTrackState;
}

const OFF: LocalTrackState = { status: "off", track: null, failure: null };

export const LOCAL_MEDIA_INITIAL: LocalMediaState = {
  devices: { mic: [], cam: [] },
  selected: { mic: null, cam: null },
  mic: OFF,
  cam: OFF,
};

/** Where the chosen device ids are kept. */
export const DEVICES_STORAGE_KEY = "bc.devices";

/** Camera capture: 360p15 (ADR 2 addendum); the browser picks the nearest mode. */
export const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 15 },
};

const INPUT_KIND: Record<LocalDeviceKind, MediaDeviceKind> = {
  mic: "audioinput",
  cam: "videoinput",
};
const FALLBACK_LABEL: Record<LocalDeviceKind, string> = { mic: "microphone", cam: "camera" };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export interface LocalMediaOptions {
  /** `navigator.mediaDevices`; undefined where capture is unsupported. */
  mediaDevices?: Pick<
    MediaDevices,
    "getUserMedia" | "enumerateDevices" | "addEventListener" | "removeEventListener"
  >;
  /** localStorage, or null where it's unavailable. */
  storage?: Storage | null;
}

type Listener = () => void;

/** `devices` as `LocalDevice`s of `kind`: unnamed ones (no permission yet) get a numbered name. */
export function devicesOf(devices: readonly MediaDeviceInfo[], kind: LocalDeviceKind) {
  return devices
    .filter((d) => d.kind === INPUT_KIND[kind] && d.deviceId)
    .map(
      (d, i): LocalDevice => ({
        id: d.deviceId,
        label: d.label || `${FALLBACK_LABEL[kind]} ${i + 1}`,
      }),
    );
}

function failureOf(error: unknown): LocalTrackFailure {
  const name = isNamed(error) ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  if (name === "TypeError") return "unsupported";
  return "busy";
}

const isNamed = (e: unknown): e is { name: string } =>
  typeof e === "object" && e !== null && typeof (e as { name?: unknown }).name === "string";

export class LocalMedia {
  readonly #mediaDevices: LocalMediaOptions["mediaDevices"];
  readonly #storage: Storage | null;
  readonly #listeners = new Set<Listener>();
  #state: LocalMediaState;
  /** Bumped per kind by every enable/disable, so a slow `getUserMedia` that lost knows it. */
  readonly #attempt: Record<LocalDeviceKind, number> = { mic: 0, cam: 0 };

  constructor(options: LocalMediaOptions = {}) {
    this.#mediaDevices = options.mediaDevices;
    this.#storage = options.storage ?? null;
    this.#state = { ...LOCAL_MEDIA_INITIAL, selected: this.#loadSelected() };
  }

  getSnapshot = (): LocalMediaState => this.#state;

  /**
   * Follow state changes. While anyone follows, the device lists are kept fresh
   * (`devicechange`). Returns an unsubscribe function.
   */
  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      this.#mediaDevices?.addEventListener("devicechange", this.#onDeviceChange);
      void this.refreshDevices();
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#mediaDevices?.removeEventListener("devicechange", this.#onDeviceChange);
      }
    };
  };

  /** List the devices again (labels appear once permission is given). */
  async refreshDevices(): Promise<void> {
    if (!this.#mediaDevices) return;
    let all: MediaDeviceInfo[];
    try {
      all = await this.#mediaDevices.enumerateDevices();
    } catch {
      return;
    }
    this.#set({ devices: { mic: devicesOf(all, "mic"), cam: devicesOf(all, "cam") } });
  }

  /**
   * Turn `kind` on with the chosen device (asking for permission the first time). Resolves to
   * the live track, or null if it failed (see `failure`) or was turned off meanwhile.
   */
  async enable(kind: LocalDeviceKind): Promise<MediaStreamTrack | null> {
    const current = this.#state[kind];
    if (current.status === "on" && current.track) return current.track;
    const attempt = ++this.#attempt[kind];
    if (!this.#mediaDevices) {
      this.#setTrack(kind, { ...OFF, failure: "unsupported" });
      return null;
    }
    this.#setTrack(kind, { status: "starting", track: null, failure: null });
    let track: MediaStreamTrack | null = null;
    let failure: LocalTrackFailure | null = null;
    const selected = this.#state.selected[kind];
    try {
      track = await this.#capture(kind, selected);
    } catch (error) {
      failure = failureOf(error);
      // The remembered device is gone: fall back to the default one.
      if (failure === "missing" && selected) {
        try {
          track = await this.#capture(kind, null);
          failure = null;
        } catch (retryError) {
          failure = failureOf(retryError);
        }
      }
    }
    if (attempt !== this.#attempt[kind]) {
      // Turned off (or on again) while the browser was asking: this one lost.
      track?.stop();
      return null;
    }
    if (!track) {
      this.#setTrack(kind, { ...OFF, failure });
      return null;
    }
    const live = track;
    // Unplugged, or revoked in the browser's UI: it's off now.
    live.addEventListener("ended", () => {
      if (this.#state[kind].track !== live) return;
      this.#attempt[kind]++;
      this.#setTrack(kind, OFF);
    });
    this.#setTrack(kind, { status: "on", track: live, failure: null });
    // Permission given: device labels (and ids, in some browsers) are listed now.
    void this.refreshDevices();
    return live;
  }

  /** Turn `kind` off, stopping its track. */
  disable(kind: LocalDeviceKind): void {
    this.#attempt[kind]++;
    this.#state[kind].track?.stop();
    this.#setTrack(kind, OFF);
  }

  /**
   * Choose the `kind` device `deviceId` (null: the browser's default) and remember it. If
   * `kind` is on, its track is swapped for one from the new device.
   */
  async select(kind: LocalDeviceKind, deviceId: string | null): Promise<void> {
    if (deviceId === this.#state.selected[kind]) return;
    this.#set({ selected: { ...this.#state.selected, [kind]: deviceId } });
    this.#saveSelected();
    if (this.#state[kind].status === "off") return;
    // Some cameras can't be opened twice, so the old one stops first.
    this.disable(kind);
    await this.enable(kind);
  }

  /** Turn everything off (leaving the room, or never entering it). Choices are kept. */
  release(): void {
    this.disable("mic");
    this.disable("cam");
  }

  #capture(kind: LocalDeviceKind, deviceId: string | null): Promise<MediaStreamTrack> {
    const device: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : {};
    const constraints: MediaStreamConstraints =
      kind === "mic" ? { audio: { ...device } } : { video: { ...CAMERA_CONSTRAINTS, ...device } };
    // biome-ignore lint/style/noNonNullAssertion: checked by the caller
    return this.#mediaDevices!.getUserMedia(constraints).then((stream) => {
      const [track] = kind === "mic" ? stream.getAudioTracks() : stream.getVideoTracks();
      for (const other of stream.getTracks()) if (other !== track) other.stop();
      if (!track) throw new DOMException("no track", "NotFoundError");
      return track;
    });
  }

  #onDeviceChange = () => {
    void this.refreshDevices();
  };

  #setTrack(kind: LocalDeviceKind, track: LocalTrackState): void {
    this.#set(kind === "mic" ? { mic: track } : { cam: track });
  }

  #set(patch: Partial<LocalMediaState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  #loadSelected(): LocalMediaState["selected"] {
    try {
      const saved = JSON.parse(this.#storage?.getItem(DEVICES_STORAGE_KEY) ?? "null") as unknown;
      if (typeof saved !== "object" || saved === null) return LOCAL_MEDIA_INITIAL.selected;
      const pick = (v: unknown) => (typeof v === "string" && v ? v : null);
      const { mic, cam } = saved as Record<string, unknown>;
      return { mic: pick(mic), cam: pick(cam) };
    } catch {
      return LOCAL_MEDIA_INITIAL.selected;
    }
  }

  #saveSelected(): void {
    try {
      this.#storage?.setItem(DEVICES_STORAGE_KEY, JSON.stringify(this.#state.selected));
    } catch {
      // Storage full or blocked: the choice just isn't remembered.
    }
  }
}

let localMedia: LocalMedia | null = null;

/** The page's `LocalMedia`, created on first call. Browser-only. */
export function getLocalMedia(): LocalMedia {
  if (!localMedia) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      // Blocked site data.
    }
    localMedia = new LocalMedia({ mediaDevices: navigator.mediaDevices, storage });
  }
  return localMedia;
}

const subscribe = (listener: Listener) => getLocalMedia().subscribe(listener);
const getSnapshot = () => getLocalMedia().getSnapshot();
const getServerSnapshot = () => LOCAL_MEDIA_INITIAL;

/** This browser's mic and camera state (`LocalMediaState`); everything off during SSR. */
export function useLocalMedia(): LocalMediaState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
