import { describe, expect, it, vi } from "vitest";
import { levelOf } from "./audio-level";
import {
  DEVICES_STORAGE_KEY,
  LocalMedia,
  type LocalMediaOptions,
  SCREEN_CONSTRAINTS,
  SCREEN_FIRST_BOX,
  SHARE_AUDIO_CONSTRAINTS,
  shareHintFor,
} from "./local-media";

type FakeTrack = MediaStreamTrack & {
  stopped: boolean;
  end: () => void;
  deviceId: string | null;
  contentHint: string;
  /** Mute it, as Firefox does a mic that was unplugged (no `ended`). */
  mute: () => void;
  endViaOnended: () => void;
};

function fakeTrack(kind: "audio" | "video", deviceId: string | null): FakeTrack {
  const ended = new Set<() => void>();
  const track = {
    kind,
    deviceId,
    contentHint: "",
    stopped: false,
    muted: false,
    mute() {
      track.muted = true;
    },
    getSettings: () => ({ deviceId: deviceId ?? undefined }),
    stop() {
      track.stopped = true;
    },
    onended: null as (() => void) | null,
    addEventListener(type: string, listener: () => void) {
      if (type === "ended") ended.add(listener);
    },
    /** The device went away: `ended` reaches the `onended` handler and every listener. */
    end() {
      track.stopped = true;
      track.onended?.();
      for (const listener of ended) listener();
    },
    /** `ended` reaches the `onended` handler only, no listeners. */
    endViaOnended() {
      track.stopped = true;
      track.onended?.();
    },
  };
  return track as unknown as FakeTrack;
}

const device = (kind: MediaDeviceKind, deviceId: string, label = "") =>
  ({ kind, deviceId, label, groupId: "" }) as MediaDeviceInfo;

/**
 * A fake `navigator.mediaDevices`: `fail` makes getUserMedia throw for a device id (or "any").
 * getDisplayMedia shares a screen, with audio unless `shareAudio` is false, or throws
 * `shareFail`.
 */
function fakeDevices(
  opts: {
    devices?: MediaDeviceInfo[];
    fail?: Record<string, string>;
    shareAudio?: boolean;
    shareFail?: string;
    /** The size the screen is captured at; `refuse` is how many `applyConstraints` calls throw. */
    screen?: { width: number; height: number; refuse?: number };
  } = {},
): NonNullable<LocalMediaOptions["mediaDevices"]> & {
  tracks: FakeTrack[];
  calls: MediaStreamConstraints[];
  displayCalls: DisplayMediaStreamOptions[];
  /** The constraints the screen track was given with `applyConstraints`. */
  applied: MediaTrackConstraints[];
  fireDeviceChange: () => void;
  devices: MediaDeviceInfo[];
} {
  const listeners = new Set<() => void>();
  const fake = {
    tracks: [] as FakeTrack[],
    calls: [] as MediaStreamConstraints[],
    displayCalls: [] as DisplayMediaStreamOptions[],
    applied: [] as MediaTrackConstraints[],
    devices: opts.devices ?? [],
    async getDisplayMedia(options: DisplayMediaStreamOptions) {
      fake.displayCalls.push(options);
      if (opts.shareFail) throw new DOMException("nope", opts.shareFail);
      const video = fakeTrack("video", null);
      if (opts.screen) {
        const { width, height } = opts.screen;
        let refused = opts.screen.refuse ?? 0;
        Object.assign(video, {
          getSettings: () => ({ width, height }),
          applyConstraints: async (constraints: MediaTrackConstraints) => {
            fake.applied.push(constraints);
            if (refused-- > 0) throw new DOMException("no", "OverconstrainedError");
          },
        });
      }
      const audio = opts.shareAudio === false ? [] : [fakeTrack("audio", null)];
      fake.tracks.push(video, ...audio);
      return {
        getAudioTracks: () => audio,
        getVideoTracks: () => [video],
        getTracks: () => [video, ...audio],
      } as unknown as MediaStream;
    },
    async getUserMedia(constraints: MediaStreamConstraints) {
      fake.calls.push(constraints);
      const wanted = (constraints.audio ?? constraints.video) as MediaTrackConstraints;
      const id = (wanted.deviceId as { exact?: string } | undefined)?.exact ?? null;
      const failure = opts.fail?.[id ?? "default"] ?? opts.fail?.any;
      if (failure) throw new DOMException("nope", failure);
      const track = fakeTrack(constraints.audio ? "audio" : "video", id);
      fake.tracks.push(track);
      return {
        getAudioTracks: () => (track.kind === "audio" ? [track] : []),
        getVideoTracks: () => (track.kind === "video" ? [track] : []),
        getTracks: () => [track],
      } as unknown as MediaStream;
    },
    async enumerateDevices() {
      return fake.devices;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    fireDeviceChange: () => {
      for (const listener of listeners) listener();
    },
  };
  return fake as never;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LocalMedia", () => {
  it("starts with mic and camera off, asking for nothing", () => {
    const mediaDevices = fakeDevices();
    const media = new LocalMedia({ mediaDevices });
    expect(media.getSnapshot().mic).toEqual({
      status: "off",
      track: null,
      failure: null,
      lost: false,
    });
    expect(media.getSnapshot().cam.status).toBe("off");
    expect(mediaDevices.calls).toEqual([]);
  });

  it("asks for a device only when it's turned on, with the chosen device", async () => {
    const mediaDevices = fakeDevices();
    const storage = memoryStorage({ [DEVICES_STORAGE_KEY]: JSON.stringify({ cam: "cam-2" }) });
    const media = new LocalMedia({ mediaDevices, storage });
    const track = await media.enable("cam");
    expect(mediaDevices.calls).toHaveLength(1);
    expect(mediaDevices.calls[0]?.audio).toBeUndefined();
    expect(mediaDevices.calls[0]?.video).toMatchObject({ deviceId: { exact: "cam-2" } });
    expect(media.getSnapshot().cam).toEqual({ status: "on", track, failure: null, lost: false });
    expect(media.getSnapshot().mic.status).toBe("off");
  });

  it("is starting while the browser asks", async () => {
    const media = new LocalMedia({ mediaDevices: fakeDevices() });
    const pending = media.enable("mic");
    expect(media.getSnapshot().mic.status).toBe("starting");
    await pending;
    expect(media.getSnapshot().mic.status).toBe("on");
  });

  it("stays off, saying so, when permission is denied", async () => {
    const media = new LocalMedia({
      mediaDevices: fakeDevices({ fail: { any: "NotAllowedError" } }),
    });
    expect(await media.enable("mic")).toBeNull();
    expect(media.getSnapshot().mic).toEqual({
      status: "off",
      track: null,
      failure: "denied",
      lost: false,
    });
  });

  it("tells a busy device and an unsupported browser apart", async () => {
    const busy = new LocalMedia({
      mediaDevices: fakeDevices({ fail: { any: "NotReadableError" } }),
    });
    await busy.enable("cam");
    expect(busy.getSnapshot().cam.failure).toBe("busy");
    const none = new LocalMedia({});
    await none.enable("cam");
    expect(none.getSnapshot().cam.failure).toBe("unsupported");
  });

  it("falls back to the default device when the remembered one is gone", async () => {
    const mediaDevices = fakeDevices({ fail: { gone: "OverconstrainedError" } });
    const storage = memoryStorage({ [DEVICES_STORAGE_KEY]: JSON.stringify({ mic: "gone" }) });
    const media = new LocalMedia({ mediaDevices, storage });
    const track = (await media.enable("mic")) as FakeTrack;
    expect(track.deviceId).toBeNull();
    expect(media.getSnapshot().mic.status).toBe("on");
  });

  it("stops the track when turned off, and on release", async () => {
    const media = new LocalMedia({ mediaDevices: fakeDevices() });
    const mic = (await media.enable("mic")) as FakeTrack;
    const cam = (await media.enable("cam")) as FakeTrack;
    media.disable("mic");
    expect(mic.stopped).toBe(true);
    expect(media.getSnapshot().mic.status).toBe("off");
    expect(cam.stopped).toBe(false);
    media.release();
    expect(cam.stopped).toBe(true);
    expect(media.getSnapshot().cam).toEqual({
      status: "off",
      track: null,
      failure: null,
      lost: false,
    });
  });

  it("drops a track that arrives after it was turned off", async () => {
    const mediaDevices = fakeDevices();
    const media = new LocalMedia({ mediaDevices });
    const pending = media.enable("cam");
    media.disable("cam");
    expect(await pending).toBeNull();
    expect(mediaDevices.tracks[0]?.stopped).toBe(true);
    expect(media.getSnapshot().cam.status).toBe("off");
  });

  it("is off and lost once its track ends by itself (unplugged)", async () => {
    const media = new LocalMedia({ mediaDevices: fakeDevices() });
    const cam = (await media.enable("cam")) as FakeTrack;
    const mic = (await media.enable("mic")) as FakeTrack;
    cam.end();
    expect(media.getSnapshot().cam).toEqual({
      status: "off",
      track: null,
      failure: null,
      lost: true,
    });
    // Only that device.
    expect(media.getSnapshot().mic).toMatchObject({ status: "on", track: mic, lost: false });
  });

  it("hears `ended` when it reaches the onended handler alone", async () => {
    const media = new LocalMedia({ mediaDevices: fakeDevices() });
    const cam = (await media.enable("cam")) as FakeTrack;
    cam.endViaOnended();
    expect(media.getSnapshot().cam).toMatchObject({ status: "off", track: null, lost: true });
    // A shared screen too.
    const video = (await media.startShare("detail")) as FakeTrack;
    video.endViaOnended();
    expect(media.getSnapshot().share.status).toBe("off");
  });

  it("isn't lost when turned off by the user, or released", async () => {
    const media = new LocalMedia({ mediaDevices: fakeDevices() });
    const cam = (await media.enable("cam")) as FakeTrack;
    media.disable("cam");
    // `stop()` fires no `ended`, but a late one from the old track must change nothing.
    cam.end();
    expect(media.getSnapshot().cam.lost).toBe(false);
    await media.enable("mic");
    media.release();
    expect(media.getSnapshot().mic.lost).toBe(false);
  });

  it("clears lost when turned on again, and a failed retry stays lost", async () => {
    const mediaDevices = fakeDevices({ fail: { gone: "NotReadableError" } });
    const storage = memoryStorage({ [DEVICES_STORAGE_KEY]: JSON.stringify({ cam: "gone" }) });
    const media = new LocalMedia({ mediaDevices, storage });
    await media.select("cam", null);
    const first = (await media.enable("cam")) as FakeTrack;
    first.end();
    expect(media.getSnapshot().cam.lost).toBe(true);
    // Still unplugged: the retry fails, and says why, with the notice still due.
    await media.select("cam", "gone");
    expect(media.getSnapshot().cam).toMatchObject({ status: "off", failure: "busy", lost: true });
    // Another device takes over.
    await media.select("cam", "cam-2");
    const second = media.getSnapshot().cam;
    expect(second).toMatchObject({ status: "on", failure: null, lost: false });
    expect((second.track as FakeTrack).deviceId).toBe("cam-2");
  });

  it("an unplugged mic Firefox only mutes is lost once devicechange no longer lists it", async () => {
    const mediaDevices = fakeDevices({
      devices: [device("audioinput", "m1", "USB mic"), device("audioinput", "m2", "Built-in")],
    });
    const storage = memoryStorage({ [DEVICES_STORAGE_KEY]: JSON.stringify({ mic: "m1" }) });
    const media = new LocalMedia({ mediaDevices, storage });
    const unsubscribe = media.subscribe(() => {});
    await flush();
    const mic = (await media.enable("mic")) as FakeTrack;
    await flush();
    // Muted but still listed (the OS muted it): not lost.
    mic.mute();
    mediaDevices.fireDeviceChange();
    await flush();
    expect(media.getSnapshot().mic.status).toBe("on");
    // Unplugged: gone from the list.
    mediaDevices.devices = [device("audioinput", "m2", "Built-in")];
    mediaDevices.fireDeviceChange();
    await flush();
    expect(media.getSnapshot().mic).toMatchObject({ status: "off", track: null, lost: true });
    expect(mic.stopped).toBe(true);
    unsubscribe();
  });

  it("a muted sole mic is lost once the list goes empty", async () => {
    const mediaDevices = fakeDevices({ devices: [device("audioinput", "m1", "USB mic")] });
    const storage = memoryStorage({ [DEVICES_STORAGE_KEY]: JSON.stringify({ mic: "m1" }) });
    const media = new LocalMedia({ mediaDevices, storage });
    const unsubscribe = media.subscribe(() => {});
    await flush();
    const mic = (await media.enable("mic")) as FakeTrack;
    await flush();
    mic.mute();
    mediaDevices.devices = [];
    mediaDevices.fireDeviceChange();
    await flush();
    expect(media.getSnapshot().mic).toMatchObject({ status: "off", track: null, lost: true });
    unsubscribe();
  });

  it("doesn't judge a track that started while the list was being taken", async () => {
    const mediaDevices = fakeDevices({ devices: [device("audioinput", "m1", "USB mic")] });
    const storage = memoryStorage({ [DEVICES_STORAGE_KEY]: JSON.stringify({ mic: "m1" }) });
    const media = new LocalMedia({ mediaDevices, storage });
    const old = (await media.enable("mic")) as FakeTrack;
    old.mute();
    // The list is taken (and answers without the old device) while a new track replaces it.
    let stale: (list: MediaDeviceInfo[]) => void = () => {};
    let calls = 0;
    mediaDevices.enumerateDevices = () =>
      ++calls === 1
        ? new Promise((resolve) => (stale = resolve))
        : Promise.resolve([device("audioinput", "m2", "Built-in")]);
    const refreshing = media.refreshDevices();
    await media.select("mic", "m2");
    await flush();
    const fresh = media.getSnapshot().mic.track as FakeTrack;
    fresh.mute();
    stale([device("audioinput", "m3", "Other")]);
    await refreshing;
    expect(media.getSnapshot().mic).toMatchObject({ status: "on", track: fresh, lost: false });
  });

  it("keeps a live, unmuted device through a devicechange that doesn't list it", async () => {
    const mediaDevices = fakeDevices({ devices: [device("videoinput", "c1", "Cam")] });
    const storage = memoryStorage({ [DEVICES_STORAGE_KEY]: JSON.stringify({ cam: "c1" }) });
    const media = new LocalMedia({ mediaDevices, storage });
    const unsubscribe = media.subscribe(() => {});
    await media.enable("cam");
    mediaDevices.devices = [device("videoinput", "c2", "Other")];
    mediaDevices.fireDeviceChange();
    await flush();
    expect(media.getSnapshot().cam.status).toBe("on");
    unsubscribe();
  });

  it("remembers the chosen devices, but not whether they were on", async () => {
    const storage = memoryStorage();
    const first = new LocalMedia({ mediaDevices: fakeDevices(), storage });
    await first.select("mic", "mic-2");
    await first.enable("mic");
    const again = new LocalMedia({ mediaDevices: fakeDevices(), storage });
    expect(again.getSnapshot().selected).toEqual({ mic: "mic-2", cam: null });
    expect(again.getSnapshot().mic.status).toBe("off");
  });

  it("swaps the live track when another device is chosen", async () => {
    const mediaDevices = fakeDevices();
    const media = new LocalMedia({ mediaDevices });
    const before = (await media.enable("cam")) as FakeTrack;
    await media.select("cam", "cam-2");
    const after = media.getSnapshot().cam.track as FakeTrack;
    expect(before.stopped).toBe(true);
    expect(after).not.toBe(before);
    expect(after.deviceId).toBe("cam-2");
    expect(media.getSnapshot().cam.status).toBe("on");
  });

  it("lists devices while followed, and again on devicechange", async () => {
    const mediaDevices = fakeDevices({
      devices: [
        device("audioinput", "m1", "Built-in mic"),
        device("videoinput", "c1"),
        device("audiooutput", "s1", "Speakers"),
        // Before permission some browsers list a blank entry.
        device("videoinput", ""),
      ],
    });
    const media = new LocalMedia({ mediaDevices });
    const listener = vi.fn();
    const unsubscribe = media.subscribe(listener);
    await flush();
    expect(media.getSnapshot().devices).toEqual({
      mic: [{ id: "m1", label: "Built-in mic" }],
      cam: [{ id: "c1", label: "camera 1" }],
    });
    mediaDevices.devices = [...mediaDevices.devices, device("videoinput", "c2", "USB cam")];
    mediaDevices.fireDeviceChange();
    await flush();
    expect(media.getSnapshot().devices.cam.map((d) => d.id)).toEqual(["c1", "c2"]);
    unsubscribe();
    expect(listener).toHaveBeenCalled();
  });
});

describe("LocalMedia screen share", () => {
  it("shares the screen and its audio, tuned for the room kind, with no voice processing", async () => {
    const mediaDevices = fakeDevices();
    const media = new LocalMedia({ mediaDevices });
    expect(media.canShare()).toBe(true);
    const pending = media.startShare("text");
    expect(media.getSnapshot().share.status).toBe("starting");
    const video = (await pending) as FakeTrack;
    const [, audio] = mediaDevices.tracks as [FakeTrack, FakeTrack];
    expect(mediaDevices.displayCalls[0]?.audio).toEqual(SHARE_AUDIO_CONSTRAINTS);
    expect(SHARE_AUDIO_CONSTRAINTS).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(video.contentHint).toBe("text");
    expect(audio.contentHint).toBe("music");
    expect(media.getSnapshot().share).toEqual({
      status: "on",
      track: video,
      audio,
      failure: null,
    });
  });

  it("shares without audio where the browser gives none", async () => {
    const media = new LocalMedia({ mediaDevices: fakeDevices({ shareAudio: false }) });
    await media.startShare("motion");
    expect(media.getSnapshot().share).toMatchObject({ status: "on", audio: null });
  });

  it("stops both tracks when stopped, on release, and when the browser's own bar stops it", async () => {
    const mediaDevices = fakeDevices();
    const media = new LocalMedia({ mediaDevices });
    await media.startShare("motion");
    media.stopShare();
    expect(mediaDevices.tracks.every((t) => t.stopped)).toBe(true);
    expect(media.getSnapshot().share.status).toBe("off");

    await media.startShare("motion");
    media.release();
    expect(mediaDevices.tracks.every((t) => t.stopped)).toBe(true);

    const video = (await media.startShare("motion")) as FakeTrack;
    video.end();
    expect(media.getSnapshot().share).toMatchObject({ status: "off", track: null, audio: null });
    expect(mediaDevices.tracks.at(-1)?.stopped).toBe(true);
  });

  it("drops a share picked after it was stopped", async () => {
    const mediaDevices = fakeDevices();
    const media = new LocalMedia({ mediaDevices });
    const pending = media.startShare("detail");
    media.stopShare();
    expect(await pending).toBeNull();
    expect(mediaDevices.tracks.every((t) => t.stopped)).toBe(true);
    expect(media.getSnapshot().share.status).toBe("off");
  });

  it("doesn't open the picker once the user's click is too long ago, and says so", async () => {
    const mediaDevices = fakeDevices();
    const userActivation = { isActive: false };
    const media = new LocalMedia({ mediaDevices, userActivation });
    expect(await media.startShare("motion")).toBeNull();
    expect(mediaDevices.displayCalls).toEqual([]);
    expect(media.getSnapshot().share).toMatchObject({ status: "off", failure: "late" });

    userActivation.isActive = true;
    expect(await media.startShare("motion")).not.toBeNull();
  });

  it("stays off when the picker is cancelled, or the browser can't share", async () => {
    const cancelled = new LocalMedia({
      mediaDevices: fakeDevices({ shareFail: "NotAllowedError" }),
    });
    expect(await cancelled.startShare("motion")).toBeNull();
    expect(cancelled.getSnapshot().share).toMatchObject({ status: "off", failure: "denied" });

    const { getDisplayMedia: _, ...mobile } = fakeDevices();
    const unsupported = new LocalMedia({ mediaDevices: mobile });
    expect(unsupported.canShare()).toBe(false);
    expect(await unsupported.startShare("motion")).toBeNull();
    expect(unsupported.getSnapshot().share.failure).toBe("unsupported");
  });
});

describe("a screen share's capture box", () => {
  const share = async (screen: { width: number; height: number; refuse?: number }, fit = true) => {
    const devices = fakeDevices({ screen });
    const media = new LocalMedia({ mediaDevices: devices, fitScreen: fit });
    const track = await media.startShare("motion");
    return { devices, media, track };
  };
  const maxes = (c: MediaTrackConstraints | undefined) =>
    [c?.width, c?.height].map((range) => (range as { max?: number } | undefined)?.max);

  it("asks for a wide first box, then refits it to the cap for a screen of another shape", async () => {
    // 5120x1440 (32:9) comes as 3840x1080; the 2970x1440 box would have left it at 67% of the cap.
    const { devices, track } = await share({ width: 3840, height: 1080 });
    expect(track).not.toBeNull();
    expect(devices.displayCalls[0]?.video).toEqual(SCREEN_FIRST_BOX);
    expect(devices.applied).toHaveLength(1);
    expect(maxes(devices.applied[0])).toEqual([3620, 1018]);
    expect(devices.applied[0]?.frameRate).toEqual({ ideal: 60 });
    // A 4K screen, 3840x2160, goes to 2560x1440.
    expect(maxes((await share({ width: 3840, height: 2160 })).devices.applied[0])).toEqual([
      2560, 1440,
    ]);
  });

  it("leaves a capture that is under the cap alone, whatever its shape", async () => {
    for (const [width, height] of [
      [1440, 2560],
      [2968, 1242],
      [1920, 1080],
      [1280, 720],
    ] as const) {
      expect((await share({ width, height })).devices.applied, `${width}x${height}`).toEqual([]);
    }
  });

  it("falls back on the fixed box if the fitted one is refused, and on the capture itself if both are", async () => {
    const first = await share({ width: 3840, height: 1080, refuse: 1 });
    expect(first.devices.applied.map(maxes)).toEqual([
      [3620, 1018],
      [2970, 1440],
    ]);
    expect(first.devices.applied[1]).toEqual(SCREEN_CONSTRAINTS);
    expect(first.track).not.toBeNull();
    const both = await share({ width: 3840, height: 1080, refuse: 2 });
    expect(both.devices.applied).toHaveLength(2);
    expect(both.track).not.toBeNull();
    expect(both.media.getSnapshot().share.status).toBe("on");
  });

  it("keeps the fixed box where refitting isn't used (Firefox)", async () => {
    const { devices, track } = await share({ width: 2970, height: 836 }, false);
    expect(track).not.toBeNull();
    expect(devices.displayCalls[0]?.video).toEqual(SCREEN_CONSTRAINTS);
    expect(devices.applied).toEqual([]);
  });
});

describe("shareHintFor", () => {
  it("tunes games, films and art for motion, code for text, and the rest for detail", () => {
    expect(shareHintFor("gaming")).toBe("motion");
    expect(shareHintFor("watch")).toBe("motion");
    expect(shareHintFor("art")).toBe("motion");
    expect(shareHintFor("code")).toBe("text");
    expect(shareHintFor("music")).toBe("detail");
    expect(shareHintFor("chat")).toBe("detail");
  });
});

describe("levelOf", () => {
  it("maps -60..0 dBFS onto 0..1", () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(0.001)).toBeCloseTo(0);
    expect(levelOf(1)).toBe(1);
    expect(levelOf(0.0316)).toBeCloseTo(0.5, 1);
  });
});

// A device that fails is reported to `onError` (#116) with the error and the labels and ids the
// browser has listed, so the report can keep them out of the message.
describe("reporting device errors", () => {
  const mic = device("audioinput", "mic-id-1", "Blue Yeti");

  it("reports a refused mic or camera once, with the device kind and the known labels and ids", async () => {
    const onError = vi.fn();
    const media = new LocalMedia({
      mediaDevices: fakeDevices({ devices: [mic], fail: { any: "NotAllowedError" } }),
      onError,
    });
    await media.refreshDevices();
    await media.enable("mic");
    await media.enable("cam");
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls.map(([kind, error]) => [kind, (error as Error).name])).toEqual([
      ["mic", "NotAllowedError"],
      ["camera", "NotAllowedError"],
    ]);
    expect(onError.mock.calls[0]?.[2]).toEqual(expect.arrayContaining(["mic-id-1", "Blue Yeti"]));
  });

  it("reports a cancelled or failed screen picker as the screen", async () => {
    const onError = vi.fn();
    const media = new LocalMedia({
      mediaDevices: fakeDevices({ shareFail: "NotAllowedError" }),
      onError,
    });
    await media.startShare("motion");
    expect(onError).toHaveBeenCalledWith(
      "screen",
      expect.objectContaining({ name: "NotAllowedError" }),
      [],
    );
  });

  it("doesn't report a start that worked, even one that fell back to the default device", async () => {
    const onError = vi.fn();
    const media = new LocalMedia({
      mediaDevices: fakeDevices({ fail: { gone: "OverconstrainedError" } }),
      storage: { getItem: () => JSON.stringify({ mic: "gone", cam: null }), setItem: () => {} },
      onError,
    });
    expect(await media.enable("mic")).not.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("is not broken by a reporter that throws", async () => {
    const media = new LocalMedia({
      mediaDevices: fakeDevices({ fail: { any: "NotReadableError" } }),
      onError: () => {
        throw new Error("reporter down");
      },
    });
    expect(await media.enable("cam")).toBeNull();
    expect(media.getSnapshot().cam.failure).toBe("busy");
  });
});
