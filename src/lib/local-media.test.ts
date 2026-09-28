import { describe, expect, it, vi } from "vitest";
import { levelOf } from "./audio-level";
import { DEVICES_STORAGE_KEY, LocalMedia, type LocalMediaOptions } from "./local-media";

type FakeTrack = MediaStreamTrack & { stopped: boolean; end: () => void; deviceId: string | null };

function fakeTrack(kind: "audio" | "video", deviceId: string | null): FakeTrack {
  const ended = new Set<() => void>();
  const track = {
    kind,
    deviceId,
    stopped: false,
    stop() {
      track.stopped = true;
    },
    addEventListener(type: string, listener: () => void) {
      if (type === "ended") ended.add(listener);
    },
    end() {
      track.stopped = true;
      for (const listener of ended) listener();
    },
  };
  return track as unknown as FakeTrack;
}

const device = (kind: MediaDeviceKind, deviceId: string, label = "") =>
  ({ kind, deviceId, label, groupId: "" }) as MediaDeviceInfo;

/** A fake `navigator.mediaDevices`: `fail` makes getUserMedia throw for a device id (or "any"). */
function fakeDevices(
  opts: { devices?: MediaDeviceInfo[]; fail?: Record<string, string> } = {},
): NonNullable<LocalMediaOptions["mediaDevices"]> & {
  tracks: FakeTrack[];
  calls: MediaStreamConstraints[];
  fireDeviceChange: () => void;
  devices: MediaDeviceInfo[];
} {
  const listeners = new Set<() => void>();
  const fake = {
    tracks: [] as FakeTrack[],
    calls: [] as MediaStreamConstraints[],
    devices: opts.devices ?? [],
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
    expect(media.getSnapshot().mic).toEqual({ status: "off", track: null, failure: null });
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
    expect(media.getSnapshot().cam).toEqual({ status: "on", track, failure: null });
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
    expect(media.getSnapshot().mic).toEqual({ status: "off", track: null, failure: "denied" });
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
    expect(media.getSnapshot().cam).toEqual({ status: "off", track: null, failure: null });
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

  it("is off once its track ends by itself (unplugged)", async () => {
    const media = new LocalMedia({ mediaDevices: fakeDevices() });
    const cam = (await media.enable("cam")) as FakeTrack;
    cam.end();
    expect(media.getSnapshot().cam.status).toBe("off");
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

describe("levelOf", () => {
  it("maps -60..0 dBFS onto 0..1", () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(0.001)).toBeCloseTo(0);
    expect(levelOf(1)).toBe(1);
    expect(levelOf(0.0316)).toBeCloseTo(0.5, 1);
  });
});
