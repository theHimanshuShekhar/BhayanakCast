// Create-room dialog, settings dialog, profile menu.
// Ported from docs/design/prototype/overlays.jsx onto Base UI Dialog/Menu (focus trap, Esc, a11y).
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { type ReactNode, useState } from "react";
import { useCurrentSession } from "~/lib/current-user";
import { ACCENTS } from "~/lib/format";
import { type CreateRoomInput, ROOM_NAME_MAX } from "~/lib/rooms";
import { useSettings } from "~/lib/settings";
import type { RoomKind } from "~/lib/types";
import { Icon } from "./icons";
import { SignInButton } from "./sign-in-button";
import { Avatar, Btn, fieldInput, fieldLabel, iconBtnCls, MonoCaps, Seg, Toggle } from "./ui";

const tagBtn = (active: boolean) =>
  `h-[26px] px-2.5 rounded-full text-[11px] border cursor-pointer select-none transition-colors ${
    active
      ? "bg-primary text-primary-ink border-transparent font-semibold"
      : "bg-canvas border-border text-fg-muted hover:text-fg hover:border-border-strong"
  }`;

const Sheet = ({
  open,
  onOpenChange,
  title,
  width,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  width: string;
  children: ReactNode;
  footer: ReactNode;
}) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-[200] bg-black/55 backdrop-blur-[3px] animate-bc-fade" />
      <Dialog.Popup
        className={`fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${width} max-h-[calc(100dvh-2rem)] flex flex-col bg-surface border border-border rounded-[var(--radius)] shadow-deep overflow-hidden outline-0 max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-b-0`}
      >
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border-subtle">
          <Dialog.Title className="m-0 text-[15px] tracking-[-0.005em] font-bold flex-1">
            {title}
          </Dialog.Title>
          <Dialog.Close className={iconBtnCls} aria-label="Close">
            <Icon.Close size={14} />
          </Dialog.Close>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4 min-h-0 overflow-auto">{children}</div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-border-subtle bg-canvas">
          {footer}
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
);

const KINDS: { id: RoomKind; label: string }[] = [
  { id: "gaming", label: "Gaming" },
  { id: "code", label: "Coding" },
  { id: "music", label: "Music" },
  { id: "art", label: "Art" },
  { id: "watch", label: "Watch party" },
  { id: "chat", label: "Just chatting" },
];
const ALL_TAGS = [
  "chill",
  "gaming",
  "coding",
  "music",
  "art",
  "cozy",
  "speedrun",
  "watch-party",
  "learning",
];

export const CreateRoomDialog = ({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Saves the room; rejects if the server refuses it. */
  onCreate: (room: CreateRoomInput) => Promise<unknown>;
}) => {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [tags, setTags] = useState<Set<string>>(() => new Set(["chill"]));
  const [kind, setKind] = useState<RoomKind>("gaming");
  const [isPrivate, setIsPrivate] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggleTag = (t: string) =>
    setTags((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  const submit = async () => {
    if (!name.trim() || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await onCreate({
        name: name.trim(),
        description: desc.trim(),
        kind,
        tags: [...tags],
        isPrivate,
      });
      setName("");
      setDesc("");
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="start a hang"
      width="w-[min(520px,94vw)]"
      footer={
        <>
          <Btn onClick={() => onOpenChange(false)}>cancel</Btn>
          <Btn variant="primary" onClick={submit} disabled={!name.trim() || pending}>
            <Icon.Broadcast size={13} /> start hang
          </Btn>
        </>
      }
    >
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="room-name" className={fieldLabel}>
            room name
          </label>
          <input
            id="room-name"
            type="text"
            placeholder="e.g. sunday synth jams"
            value={name}
            maxLength={ROOM_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            className={fieldInput}
          />
        </div>

        <fieldset className="flex flex-col gap-1.5 m-0 p-0 border-0">
          <legend className={`${fieldLabel} mb-1.5`}>what kind of room</legend>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={kind === k.id}
                className={tagBtn(kind === k.id)}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5 m-0 p-0 border-0">
          <legend className={`${fieldLabel} mb-1.5`}>tags · pick a few</legend>
          <div className="flex flex-wrap gap-1.5">
            {ALL_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tags.has(t)}
                className={tagBtn(tags.has(t))}
                onClick={() => toggleTag(t)}
              >
                #{t}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="room-desc" className={fieldLabel}>
            description (optional)
          </label>
          <textarea
            id="room-desc"
            rows={2}
            placeholder="what's going down in this room…"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className={`${fieldInput} resize-none font-[inherit]`}
          />
        </div>

        <Toggle
          k="private room"
          d="invite link only · host or a mod approves each join"
          on={isPrivate}
          onChange={setIsPrivate}
        />
        {failed && (
          <p role="alert" className="m-0 text-[11.5px] text-live-ink">
            couldn't start the room. check the details and try again.
          </p>
        )}
      </form>
    </Sheet>
  );
};

export const SettingsDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { settings, update } = useSettings();
  const { user } = useCurrentSession();
  const row = "flex flex-col gap-1.5";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="settings"
      width="w-[min(480px,94vw)]"
      footer={
        <Btn variant="primary" onClick={() => onOpenChange(false)}>
          done
        </Btn>
      }
    >
      {user && (
        <>
          <MonoCaps>profile</MonoCaps>
          <div className="flex items-center gap-3 -mt-2">
            <Avatar name={user.username} size="lg" ring />
            <div className="flex-1 min-w-0 text-[11px] text-muted">
              discord <span className="text-fg-muted font-medium">{user.username}</span>
            </div>
          </div>
        </>
      )}
      <MonoCaps>appearance</MonoCaps>
      <div className={`${row} -mt-2`}>
        <span className={fieldLabel}>theme</span>
        <Seg
          value={settings.theme}
          options={["light", "dark"] as const}
          onChange={(theme) => update({ theme })}
        />
      </div>
      <div className={row}>
        <span className={fieldLabel}>accent</span>
        <div className="flex gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.h}
              type="button"
              title={a.name}
              aria-label={a.name}
              aria-pressed={settings.accentHue === a.h}
              onClick={() => update({ accentHue: a.h })}
              className={`w-7 h-7 rounded-lg border border-border-strong cursor-pointer transition-transform hover:scale-[1.08] ${settings.accentHue === a.h ? "outline-2 outline-fg outline-offset-2" : ""}`}
              style={{ background: `oklch(0.68 0.19 ${a.h})` }}
            />
          ))}
        </div>
      </div>
      <div className={row}>
        <span className={fieldLabel}>corner radius</span>
        <Seg
          value={settings.radius}
          options={[
            { k: "sharp", v: 4 },
            { k: "default", v: 12 },
            { k: "soft", v: 16 },
            { k: "round", v: 24 },
          ]}
          onChange={(radius) => update({ radius })}
        />
      </div>
      <MonoCaps>rooms</MonoCaps>
      <div className={`${row} -mt-2`}>
        <span className={fieldLabel}>tile density</span>
        <Seg
          value={settings.density}
          options={["compact", "comfortable", "spacious"] as const}
          onChange={(density) => update({ density })}
        />
      </div>
      <div className={row}>
        <span className={fieldLabel}>stage layout</span>
        <Seg
          value={settings.layout}
          options={["mosaic", "grid", "spotlight"] as const}
          onChange={(layout) => update({ layout })}
        />
      </div>
      <Toggle
        k="chat panel"
        d="show chat, people and feed beside the stage"
        on={settings.showChat}
        onChange={(showChat) => update({ showChat })}
      />
    </Sheet>
  );
};

/**
 * What a visitor tried to do: enter a room (named when we know it) or start one.
 * The shell opens the prompt instead of navigating or showing the create dialog.
 */
export type SignInPrompt = { kind: "join"; roomName?: string } | { kind: "create" };

export const SignInPromptDialog = ({
  prompt,
  onOpenChange,
}: {
  prompt: SignInPrompt | null;
  onOpenChange: (open: boolean) => void;
}) => {
  const create = prompt?.kind === "create";
  const roomName = prompt?.kind === "join" ? prompt.roomName : undefined;
  return (
    <Sheet
      open={prompt !== null}
      onOpenChange={onOpenChange}
      title={create ? "sign in to start a room" : "sign in to join"}
      width="w-[min(400px,94vw)]"
      footer={<Btn onClick={() => onOpenChange(false)}>not now</Btn>}
    >
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 shrink-0 rounded-xl grid place-items-center bg-surface-2 border border-border text-primary shadow-[var(--shadow-card),0_0_18px_var(--color-primary-glow)]">
          {create ? <Icon.Broadcast size={18} /> : <Icon.Headset size={18} />}
        </span>
        <p className="m-0 text-[12.5px] text-muted leading-relaxed">
          {create ? (
            "Rooms are hosted by signed-in users. Sign in with Discord to start your own and invite your crew."
          ) : roomName ? (
            <>
              <span className="text-fg font-semibold">{roomName}</span> is live. Sign in with
              Discord to jump in, share your screen and chat.
            </>
          ) : (
            "Sign in with Discord to join rooms, share your screen and chat."
          )}
        </p>
      </div>
      <SignInButton />
    </Sheet>
  );
};

const menuItem =
  "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] text-fg-muted outline-0 cursor-pointer data-highlighted:bg-surface-2 data-highlighted:text-fg transition-colors";

export const ProfileMenu = ({
  username,
  onOpenProfile,
  onSettings,
  onSignOut,
}: {
  username: string;
  onOpenProfile: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) => (
  <Menu.Root>
    <Menu.Trigger
      className="w-9 h-9 p-0 rounded-[10px] bg-transparent grid place-items-center cursor-pointer"
      aria-label="Account menu"
    >
      <Avatar name={username} size="md" ring />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner side="right" align="end" sideOffset={14} className="z-[150] outline-0">
        <Menu.Popup className="w-[260px] bg-surface border border-border-strong rounded-[var(--radius)] shadow-deep overflow-hidden outline-0 origin-[var(--transform-origin)] transition-[scale,opacity] duration-100 data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0">
          <div className="flex items-center gap-2.5 px-3 py-3 border-b border-border-subtle bg-canvas">
            <Avatar name={username} size="lg" ring />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13px]">{username}</div>
              <div className="text-[11px] text-muted">· connected via discord</div>
            </div>
          </div>
          <div className="p-1.5">
            <Menu.Item className={menuItem} onClick={onOpenProfile}>
              <Icon.Users size={14} /> my profile
            </Menu.Item>
            <Menu.Item className={menuItem} onClick={onSettings}>
              <Icon.Gear size={14} /> settings
            </Menu.Item>
            <Menu.Separator className="h-px bg-border-subtle my-1.5 mx-1" />
            <Menu.Item className={`${menuItem} !text-live-ink`} onClick={onSignOut}>
              <Icon.Logout size={14} /> sign out
            </Menu.Item>
          </div>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
);
