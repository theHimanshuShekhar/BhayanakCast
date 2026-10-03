// The pre-join lobby (CONTEXT.md): pick and preview mic and camera before entering a room.
// Both start off, and the browser asks for permission only when one is first turned on.
import { type ReactNode, useEffect, useId, useRef } from "react";
import { watchAudioLevel } from "~/lib/audio-level";
import {
  getLocalMedia,
  type LocalDeviceKind,
  type LocalTrackFailure,
  useLocalMedia,
} from "~/lib/local-media";
import type { RoomPerson } from "~/lib/rooms";
import { Icon } from "../icons";
import { Avatar, AvatarStack, Btn, fieldInput, fieldLabel, MonoCaps } from "../ui";
import { ControlBtn } from "./control-btn";

const NAMES: Record<LocalDeviceKind, string> = { mic: "microphone", cam: "camera" };

/** Why `kind` didn't turn on, in words, with what to do about it. */
export function failureText(kind: LocalDeviceKind, failure: LocalTrackFailure): string {
  const name = NAMES[kind];
  switch (failure) {
    case "denied":
      return `${name} access is blocked. allow it for this site (the icon by the address bar), then turn it on again.`;
    case "missing":
      return `no ${name} found. plug one in, or pick another, and try again.`;
    case "busy":
      return `couldn't start your ${name}. another app may be using it.`;
    case "unsupported":
      return `this browser can't use a ${name} here.`;
  }
}

/** `names` in words: "a", "a and b", "a, b and 3 others". */
const peopleText = (names: string[]) => {
  if (names.length <= 2) return names.join(" and ");
  const rest = names.length - 2;
  return `${names.slice(0, 2).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
};

export interface LobbyProps {
  roomName: string;
  /** The host's username, if they have one. */
  host: string | null;
  /** Who is inside now (not counting you). */
  people: RoomPerson[];
  capacity: number;
  /** Your username and picture, for the preview while the camera is off. */
  me: string;
  meImage: string | null;
  /** Enter with the mic and camera as they are now. */
  onEnter: (media: { mic: boolean; cam: boolean }) => void;
  onBack: () => void;
}

/** The local mic and camera as the device check shows them: on, or one still starting. */
export function useDeviceState() {
  const local = useLocalMedia();
  return {
    local,
    micOn: local.mic.status === "on",
    camOn: local.cam.status === "on",
    starting: local.mic.status === "starting" || local.cam.status === "starting",
  };
}

export function Lobby({
  roomName,
  host,
  people,
  capacity,
  me,
  meImage,
  onEnter,
  onBack,
}: LobbyProps) {
  const { micOn, camOn, starting } = useDeviceState();
  const full = people.length >= capacity;

  return (
    <DeviceCheck
      kicker="about to join"
      roomName={roomName}
      subtitle={host && `hosted by ${host}`}
      me={me}
      meImage={meImage}
      info={
        <div className="flex items-center gap-2.5 min-w-0">
          {people.length > 0 && <AvatarStack people={people} max={4} />}
          <p className="m-0 text-[12px] text-fg-muted min-w-0">
            {people.length === 0
              ? "nobody's inside yet. you'll be the first."
              : `${peopleText(people.map((p) => p.username))} ${people.length === 1 ? "is" : "are"} inside`}
            <span className="text-muted">
              {" "}
              · {people.length}/{capacity}
            </span>
          </p>
        </div>
      }
    >
      <p className="m-0 text-[11px] text-muted">
        you'll enter with the mic {micOn ? "on" : "muted"} and the camera {camOn ? "on" : "off"}.
        {full && " the room is full: you'll get in as soon as a spot frees up."}
      </p>

      <div className="flex gap-2 mt-auto">
        <Btn onClick={onBack}>back</Btn>
        <Btn
          variant="primary"
          className="flex-1"
          disabled={starting}
          onClick={() => onEnter({ mic: micOn, cam: camOn })}
        >
          <Icon.Broadcast size={13} /> enter room
        </Btn>
      </div>
    </DeviceCheck>
  );
}

export interface DeviceCheckProps {
  /** Above the room's name ("about to join"). */
  kicker: string;
  roomName: string;
  /** Under the room's name, if anything. */
  subtitle?: string | null;
  /** Your username and picture, for the preview while the camera is off. */
  me: string;
  meImage: string | null;
  /** Between the room's name and the device pickers: who's inside, or where a knock stands. */
  info: ReactNode;
  /** Under the device pickers: what happens next, and the buttons. */
  children: ReactNode;
}

/**
 * The lobby's device check: the camera preview, mic and camera switches, mic meter and device
 * pickers, beside the room's name. The lobby wraps it, and so does a private room's knock
 * screen, so a knocker can set up while they wait.
 */
export function DeviceCheck({
  kicker,
  roomName,
  subtitle,
  me,
  meImage,
  info,
  children,
}: DeviceCheckProps) {
  const { local, micOn, camOn } = useDeviceState();
  const media = getLocalMedia();
  const toggle = (kind: LocalDeviceKind) => {
    if (local[kind].status === "off") void media.enable(kind);
    else media.disable(kind);
  };
  const failures = (["cam", "mic"] as const).flatMap((kind) => {
    const failure = local[kind].failure;
    return failure ? [{ kind, text: failureText(kind, failure) }] : [];
  });

  return (
    <div className="h-full overflow-auto grid place-items-center px-4 py-8 max-sm:py-4 bg-bg">
      <section
        aria-labelledby="lobby-title"
        className="w-[min(860px,100%)] grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5 p-5 max-sm:p-3.5 bg-surface border border-border rounded-[var(--radius-lg)] shadow-pop"
      >
        <div className="flex flex-col gap-3 min-w-0">
          <div className="relative aspect-video rounded-[var(--radius)] overflow-hidden bg-canvas border border-border-subtle">
            {camOn && local.cam.track ? (
              <Preview track={local.cam.track} />
            ) : (
              // Centred above the mic and camera buttons, which sit along the bottom.
              <div className="absolute inset-0 grid place-items-center pb-14">
                <div className="flex flex-col items-center gap-2.5 max-sm:gap-1.5">
                  <Avatar
                    name={me}
                    image={meImage}
                    size="xl"
                    className="max-sm:!w-14 max-sm:!h-14 max-sm:!text-[18px]"
                  />
                  <span className="text-[11.5px] text-muted">
                    {local.cam.status === "starting" ? "starting camera…" : "camera is off"}
                  </span>
                </div>
              </div>
            )}
            <div className="absolute bottom-3 inset-x-0 flex justify-center gap-2">
              <ControlBtn
                role="switch"
                aria-checked={micOn}
                aria-label="Microphone"
                title={micOn ? "Turn mic off" : "Turn mic on"}
                state={micOn ? "active" : undefined}
                disabled={local.mic.status === "starting"}
                onClick={() => toggle("mic")}
              >
                {micOn ? <Icon.Mic size={16} /> : <Icon.MicOff size={16} />}
              </ControlBtn>
              <ControlBtn
                role="switch"
                aria-checked={camOn}
                aria-label="Camera"
                title={camOn ? "Turn camera off" : "Turn camera on"}
                state={camOn ? "active" : undefined}
                disabled={local.cam.status === "starting"}
                onClick={() => toggle("cam")}
              >
                {camOn ? <Icon.Cam size={16} /> : <Icon.CamOff size={16} />}
              </ControlBtn>
            </div>
          </div>
          <MicMeter track={micOn ? local.mic.track : null} />
          {failures.map(({ kind, text }) => (
            <p key={kind} role="alert" className="m-0 text-[11.5px] text-live-ink">
              {text}
            </p>
          ))}
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <div className="flex flex-col gap-1.5">
            <MonoCaps>{kicker}</MonoCaps>
            <h1 id="lobby-title" className="m-0 text-lg font-semibold break-words">
              {roomName}
            </h1>
            {subtitle && <p className="m-0 text-[11.5px] text-muted">{subtitle}</p>}
          </div>

          {info}

          <DevicePicker kind="mic" />
          <DevicePicker kind="cam" />

          {children}
        </div>
      </section>
    </div>
  );
}

/** The chosen `kind` device, from the devices the browser lists. */
export function DevicePicker({ kind }: { kind: LocalDeviceKind }) {
  const local = useLocalMedia();
  // Unique: the lobby and a room's device-lost notice both show one.
  const id = `${kind}-device-${useId()}`;
  const devices = local.devices[kind];
  const selected = local.selected[kind] ?? "";
  // The remembered device shows even when it isn't listed: unplugged now, or (before
  // permission is given) the browser doesn't list devices yet.
  const unlisted = selected && !devices.some((d) => d.id === selected);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={fieldLabel}>
        {kind === "mic" ? "mic device" : "camera device"}
      </label>
      <select
        id={id}
        value={selected}
        disabled={local[kind].status === "starting"}
        onChange={(e) => void getLocalMedia().select(kind, e.target.value || null)}
        className={`${fieldInput} min-w-0 cursor-pointer disabled:opacity-60`}
      >
        <option value="">system default</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
        {unlisted && (
          <option value={selected}>
            {devices.length > 0 ? "unavailable device" : `your last ${NAMES[kind]}`}
          </option>
        )}
      </select>
    </div>
  );
}

/** The camera `track`, mirrored like a mirror. */
function Preview({ track }: { track: MediaStreamTrack }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = new MediaStream([track]);
    return () => {
      el.srcObject = null;
    };
  }, [track]);
  return (
    <video
      ref={video}
      aria-label="camera preview"
      autoPlay
      muted
      playsInline
      className="absolute inset-0 w-full h-full object-cover -scale-x-100"
    />
  );
}

/** How loud the mic `track` is right now (empty while the mic is off). */
function MicMeter({ track }: { track: MediaStreamTrack | null }) {
  const meter = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = (level: number) => {
      if (bar.current) bar.current.style.width = `${Math.round(level * 100)}%`;
      meter.current?.setAttribute("aria-valuenow", String(Math.round(level * 100)));
    };
    show(0);
    if (!track) return;
    const stop = watchAudioLevel(track, show);
    return () => {
      stop();
      show(0);
    };
  }, [track]);
  return (
    <div className="flex items-center gap-2.5">
      <Icon.Mic size={13} className="text-muted flex-shrink-0" />
      {/* biome-ignore lint/a11y/useSemanticElements: a native <meter> can't be styled alike in Chromium and Firefox */}
      <div
        ref={meter}
        role="meter"
        aria-label="mic level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        className="relative flex-1 h-1.5 rounded-full bg-canvas border border-border-subtle overflow-hidden"
      >
        <div
          ref={bar}
          className="absolute inset-y-0 left-0 w-0 rounded-full bg-primary transition-[width] duration-75"
        />
      </div>
      <span className="text-[10.5px] text-muted w-14 text-right">
        {track ? "mic on" : "mic off"}
      </span>
    </div>
  );
}
