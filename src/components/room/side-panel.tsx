// Room sidebar — chat / people / feed tabs (Base UI Tabs). Ported from docs/design/prototype/room.jsx.
import { Tabs } from "@base-ui/react/tabs";
import { type FormEvent, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import type { ActivityItem, ChatMessage, Participant, RoomDetail, RoomRole } from "~/lib/types";
import { Icon } from "../icons";
import { Avatar, Chip, IconBtn } from "../ui";

const ROLE_BADGE: Partial<Record<RoomRole, string>> = {
  mod: "bg-primary-soft text-primary-strong border border-[color-mix(in_oklch,var(--color-primary)_35%,transparent)]",
  host: "bg-primary text-primary-ink border border-transparent",
};
const RoleBadge = ({ role }: { role: RoomRole }) => (
  <span
    className={`text-[9.5px] px-[5px] py-px rounded tracking-[0.05em] uppercase ${ROLE_BADGE[role] ?? "bg-surface-2 text-muted border border-border"}`}
  >
    {role}
  </span>
);

const renderMentions = (text: string) =>
  text.split(/(@[\w.]+)/g).map((part, i) =>
    part.startsWith("@") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split parts have no stable identity
      <span key={i} className="text-primary font-semibold">
        {part}
      </span>
    ) : (
      part
    ),
  );

const ChatLine = ({
  m,
  host,
  onOpenProfile,
}: {
  m: ChatMessage;
  host: string | null;
  onOpenProfile: (u: string) => void;
}) => {
  if (m.system)
    return (
      <div className="my-1.5 py-1.5 text-center text-[10.5px] text-muted tracking-[0.04em] border-y border-dashed border-border">
        — {m.text} —
      </div>
    );
  const role: RoomRole = m.user === host ? "host" : m.role;
  const whoCls = role === "member" ? "" : "text-primary-strong";
  return (
    <div className="flex gap-2 py-1.5">
      <button
        type="button"
        onClick={() => onOpenProfile(m.user)}
        aria-label={`View ${m.user}'s profile`}
        className="self-start rounded-full cursor-pointer"
      >
        <Avatar name={m.user} size="sm" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={() => onOpenProfile(m.user)}
            className={`font-semibold text-[11.5px] cursor-pointer hover:underline underline-offset-2 ${whoCls}`}
          >
            {m.user}
          </button>
          {role !== "member" && <RoleBadge role={role} />}
          <span className="text-[10px] text-subtle">{m.ts}</span>
        </div>
        <div className="text-xs text-fg break-words">{renderMentions(m.text)}</div>
      </div>
    </div>
  );
};

const EmptyNote = ({ children }: { children: ReactNode }) => (
  <p className="m-0 py-6 text-center text-[11.5px] text-muted">{children}</p>
);

const GroupHead = ({ children, count }: { children: ReactNode; count: number }) => (
  <div className="flex items-center gap-2 mt-2.5 mb-1.5 mx-1 text-[10px] uppercase tracking-[0.12em] text-muted">
    {children}{" "}
    <span className="bg-surface-2 px-1.5 py-px rounded-full text-[9.5px] text-muted">{count}</span>
  </div>
);

const ParticipantRow = ({
  p,
  onOpenProfile,
}: {
  p: Participant;
  onOpenProfile: (u: string) => void;
}) => (
  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface">
    <button
      type="button"
      onClick={() => onOpenProfile(p.name)}
      aria-label={`View ${p.name}'s profile`}
      className="rounded-full cursor-pointer hover:brightness-110"
    >
      <Avatar name={p.name} size="md" ring={p.speaking} />
    </button>
    <div className="flex-1 min-w-0">
      <button
        type="button"
        onClick={() => onOpenProfile(p.name)}
        className="block max-w-full text-left text-xs font-medium truncate cursor-pointer hover:text-primary-strong hover:underline underline-offset-2"
      >
        {p.you ? `${p.name} (you)` : p.name}
      </button>
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
        {p.role !== "member" && <RoleBadge role={p.role} />}
        {p.streaming && (
          <Chip kind="live" dot>
            live
          </Chip>
        )}
      </div>
    </div>
    <div className="flex gap-1 text-muted">
      {p.muted ? <Icon.MicOff size={13} /> : <Icon.Mic size={13} />}
      {p.camera ? <Icon.Cam size={13} /> : <Icon.CamOff size={13} />}
    </div>
  </div>
);

const tabCls =
  "flex-1 h-8 text-[11px] rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer text-muted hover:text-fg outline-0 focus-visible:outline-2 focus-visible:outline-primary data-active:bg-surface-2 data-active:text-fg data-active:shadow-card";
const panelCls = "flex-1 min-h-0 overflow-auto px-3 py-2.5 outline-0";

export const RoomSide = ({
  room,
  participants,
  chat,
  activity,
  onSend,
  onOpenProfile,
  open,
  onClose,
}: {
  room: RoomDetail;
  participants: Participant[];
  chat: ChatMessage[];
  activity: ActivityItem[];
  onSend: (text: string) => void;
  onOpenProfile: (username: string) => void;
  open: boolean;
  onClose: () => void;
}) => {
  const [tab, setTab] = useState<string>("chat");
  const [draft, setDraft] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages / tab switch
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat.length, tab]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  const groups: [string, Participant[]][] = [
    ["streaming", participants.filter((p) => p.streaming)],
    ["host & mods", participants.filter((p) => !p.streaming && p.role !== "member")],
    ["viewers", participants.filter((p) => !p.streaming && p.role === "member")],
  ];

  return (
    <aside
      aria-label="Room chat and people"
      className={`flex flex-col min-w-0 min-h-0 bg-canvas border-l border-border-subtle max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-[120] max-lg:w-[min(380px,100%)] max-lg:shadow-deep ${open ? "" : "max-lg:hidden"}`}
    >
      <Tabs.Root value={tab} onValueChange={setTab} className="flex flex-col min-h-0 flex-1">
        <div className="flex items-center gap-0.5 p-2.5 pb-0">
          <Tabs.List className="flex flex-1 gap-0.5">
            <Tabs.Tab value="chat" className={tabCls}>
              <Icon.Chat size={13} /> chat
            </Tabs.Tab>
            <Tabs.Tab value="people" className={tabCls}>
              <Icon.Users size={13} /> people · {participants.length}
            </Tabs.Tab>
            <Tabs.Tab value="activity" className={tabCls}>
              <Icon.Activity size={13} /> feed
            </Tabs.Tab>
          </Tabs.List>
          <IconBtn
            onClick={onClose}
            aria-label="Close panel"
            className="lg:hidden !w-8 !h-8 flex-shrink-0"
          >
            <Icon.Close size={14} />
          </IconBtn>
        </div>

        <Tabs.Panel value="chat" className="flex flex-col flex-1 min-h-0 outline-0">
          <div className={panelCls} ref={chatRef} aria-live="polite">
            {chat.length === 0 && <EmptyNote>no messages yet. say hi!</EmptyNote>}
            {chat.map((m) => (
              <ChatLine key={m.id} m={m} host={room.host} onOpenProfile={onOpenProfile} />
            ))}
          </div>
          <div className="px-3 py-2.5 border-t border-border-subtle bg-canvas">
            <form
              className="flex items-center gap-1.5 bg-surface border border-border rounded-xl py-1 pr-1 pl-3 focus-within:border-primary"
              onSubmit={submit}
            >
              <input
                aria-label="Chat message"
                className="flex-1 min-w-0 bg-transparent border-0 outline-0 h-8 text-xs"
                placeholder="say something…"
                maxLength={500}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <IconBtn type="submit" aria-label="Send" className="!w-7 !h-7 !text-primary">
                <Icon.Send size={14} />
              </IconBtn>
            </form>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="people" className={panelCls}>
          {groups.map(
            ([label, list]) =>
              list.length > 0 && (
                <Fragment key={label}>
                  <GroupHead count={list.length}>{label}</GroupHead>
                  {list.map((p) => (
                    <ParticipantRow key={p.id} p={p} onOpenProfile={onOpenProfile} />
                  ))}
                </Fragment>
              ),
          )}
        </Tabs.Panel>

        <Tabs.Panel value="activity" className={panelCls}>
          {activity.length === 0 && <EmptyNote>nothing has happened yet.</EmptyNote>}
          {activity.map((a, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only feed
              key={i}
              className="flex gap-2.5 py-2 border-t border-dashed border-border-subtle first:border-t-0"
            >
              <span className="w-[7px] h-[7px] mt-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary-glow)] flex-shrink-0" />
              <div className="text-[11.5px] text-fg-muted leading-normal">
                <span className="text-fg font-semibold">{a.who}</span> {a.what}
                <span className="block mt-0.5 text-[10.5px] text-subtle">{a.when}</span>
              </div>
            </div>
          ))}
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
};
