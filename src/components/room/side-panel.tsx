// Room sidebar — chat / people / feed tabs (Base UI Tabs). Ported from docs/design/prototype/room.jsx.
import { Tabs } from "@base-ui/react/tabs";
import { Link } from "@tanstack/react-router";
import { type FormEvent, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { tokenizeChat } from "~/lib/chat-text";
import { CHAT_MAX_LENGTH, type KnockEntry } from "~/lib/realtime";
import type { ActivityItem, ChatMessage, Participant, RoomRole } from "~/lib/types";
import { Icon } from "../icons";
import { Avatar, Btn, Chip, IconBtn } from "../ui";
import { EmojiPicker } from "./emoji-picker";
import { type ModAction, ModerateMenu } from "./tile";

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

/** Chat text with @mentions highlighted (yours more strongly) and http(s) URLs as safe links. */
const ChatText = ({ text, me }: { text: string; me: string | null }) =>
  tokenizeChat(text).map((token, i) => {
    switch (token.kind) {
      case "mention":
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no stable identity
            key={i}
            className={`text-primary font-semibold ${token.username === me ? "bg-primary-soft rounded px-0.5" : ""}`}
          >
            {token.text}
          </span>
        );
      case "link":
        return (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no stable identity
            key={i}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 break-all"
          >
            {token.text}
          </a>
        );
      default:
        // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no stable identity
        return <Fragment key={i}>{token.text}</Fragment>;
    }
  });

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const ChatLine = ({
  m,
  image,
  me,
  onOpenProfile,
}: {
  m: ChatMessage;
  /** The sender's picture, if they're still in the room. */
  image: string | null;
  me: string | null;
  onOpenProfile: (u: string) => void;
}) => {
  if (m.system)
    return (
      <div className="my-1.5 py-1.5 text-center text-[10.5px] text-muted tracking-[0.04em] border-y border-dashed border-border animate-bc-enter">
        — {m.text} —
      </div>
    );
  const role: RoomRole = m.role;
  const whoCls = role === "member" ? "" : "text-primary-strong";
  return (
    <div className="flex gap-2 py-1.5 animate-bc-enter">
      <button
        type="button"
        onClick={() => onOpenProfile(m.user)}
        aria-label={`View ${m.user}'s profile`}
        className="self-start rounded-full cursor-pointer"
      >
        <Avatar name={m.user} image={image} size="sm" />
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
          <time dateTime={m.at} className="text-[10px] text-muted tabular-nums">
            {hhmm(m.at)}
          </time>
        </div>
        <div className="text-xs text-fg break-words">
          <ChatText text={m.text} me={me} />
        </div>
      </div>
    </div>
  );
};

// Feed dots follow the event: live red for a share starting (The Tally Rule), green for an
// arrival, the accent for roles, muted for leaving and stopping.
const FEED_DOT: Partial<Record<ActivityItem["kind"], string>> = {
  shareStarted: "bg-live shadow-[0_0_8px_var(--color-live)]",
  joined: "bg-success",
  roleChanged: "bg-primary",
  hostChanged: "bg-primary",
  reaction: "bg-primary",
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
  moderation,
}: {
  p: Participant;
  onOpenProfile: (u: string) => void;
  moderation: Moderation;
}) => (
  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface">
    <button
      type="button"
      onClick={() => onOpenProfile(p.name)}
      aria-label={`View ${p.name}'s profile`}
      className="rounded-full cursor-pointer hover:brightness-110"
    >
      <Avatar name={p.name} image={p.image} size="md" ring={p.speaking} />
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
    <ModerateMenu
      p={p}
      {...moderation}
      triggerClassName="w-7 h-7 -mr-1 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-muted cursor-pointer hover:bg-surface-2 hover:text-fg data-popup-open:bg-surface-2"
    />
  </div>
);

/** Who's looking, so the people tab offers the same moderation as tiles. */
type Moderation = {
  myRole: RoomRole;
  admin: boolean;
  onModerate: (id: string, action: ModAction) => void;
};

/** Someone knocking (ADR 16), for the host, mods and admins: who, and admit or deny. */
const KnockRow = ({
  knock,
  onDecide,
}: {
  knock: KnockEntry;
  onDecide: (userId: string, admit: boolean) => void;
}) => (
  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface">
    <Link
      to="/profile/$userId"
      params={{ userId: knock.userId }}
      className="flex flex-1 min-w-0 items-center gap-2.5 text-xs font-medium hover:text-primary-strong hover:underline underline-offset-2"
    >
      <Avatar name={knock.username} image={knock.image} size="md" />
      <span className="truncate">{knock.username}</span>
    </Link>
    <div className="flex gap-1 flex-shrink-0">
      <Btn
        size="sm"
        variant="primary"
        aria-label={`admit ${knock.username}`}
        onClick={() => onDecide(knock.userId, true)}
      >
        admit
      </Btn>
      <Btn
        size="sm"
        aria-label={`deny ${knock.username}`}
        onClick={() => onDecide(knock.userId, false)}
      >
        deny
      </Btn>
    </div>
  </div>
);

const tabCls =
  "flex-1 h-8 text-[11px] rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer text-muted hover:text-fg outline-0 focus-visible:outline-2 focus-visible:outline-primary data-active:bg-surface-2 data-active:text-fg data-active:shadow-card";
const panelCls = "flex-1 min-h-0 overflow-auto px-3 py-2.5 outline-0";

const NOTICE_MS = 4_000;

export const RoomSide = ({
  participants,
  chat,
  chatError,
  activity,
  onSend,
  canSend,
  onOpenProfile,
  knocks,
  onDecideKnock,
  moderation,
  open,
  onClose,
}: {
  participants: Participant[];
  chat: ChatMessage[];
  /** The server's latest refusal of a chat message; a new object each time. */
  chatError: { message: string } | null;
  activity: ActivityItem[];
  /** Send a chat message; false if it couldn't be sent (not connected). */
  onSend: (text: string) => boolean;
  /** False until the server has admitted us to the room; sending waits for that. */
  canSend: boolean;
  onOpenProfile: (username: string) => void;
  /** Knocks pending on a private room, shown to those who can decide them; else empty. */
  knocks: KnockEntry[];
  onDecideKnock: (userId: string, admit: boolean) => void;
  /** The viewer's role and the moderation handler, for the people tab's menus. */
  moderation: Moderation;
  open: boolean;
  onClose: () => void;
}) => {
  const [tab, setTab] = useState<string>("chat");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** The last message sent, restored to the composer if the server refuses it. */
  const lastSent = useRef<string | null>(null);
  /** Where to put the caret after the draft changes (an emoji was inserted). */
  const caret = useRef<number | null>(null);
  const me = participants.find((p) => p.you)?.name ?? null;
  // Chat lines carry no picture; the sender's comes from the room's people.
  const images = new Map(participants.map((p) => [p.userId, p.image]));

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages / tab switch
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat.length, tab]);

  useEffect(() => {
    if (!chatError) return;
    setNotice(chatError.message);
    const refused = lastSent.current;
    lastSent.current = null;
    if (refused) setDraft((d) => d || refused);
  }, [chatError]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each draft change
  useEffect(() => {
    const at = caret.current;
    const input = inputRef.current;
    if (at === null || !input) return;
    caret.current = null;
    // After the picker has closed and handed focus back to the input.
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(at, at);
    });
  }, [draft]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (!canSend) return;
    if (!onSend(text)) {
      setNotice("not connected. trying to reconnect…");
      return;
    }
    lastSent.current = text;
    setNotice(null);
    setDraft("");
  };

  /** Put `emoji` in the draft at the caret (replacing any selection), within the length cap. */
  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    if (draft.length - (end - start) + emoji.length > CHAT_MAX_LENGTH) return;
    caret.current = start + emoji.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
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
              <ChatLine
                key={m.id}
                m={m}
                image={m.system ? null : (images.get(m.userId) ?? null)}
                me={me}
                onOpenProfile={onOpenProfile}
              />
            ))}
          </div>
          <div className="px-3 py-2.5 border-t border-border-subtle bg-canvas">
            <p
              role="status"
              className={`m-0 text-[10.5px] text-live-ink ${notice ? "mb-1.5" : "sr-only"}`}
            >
              {notice}
            </p>
            <form
              className="flex items-center gap-1 bg-surface border border-border rounded-xl py-1 pr-1 pl-3 focus-within:border-primary"
              onSubmit={submit}
            >
              <input
                ref={inputRef}
                aria-label="Chat message"
                className="flex-1 min-w-0 bg-transparent border-0 outline-0 h-8 text-xs"
                placeholder="say something…"
                maxLength={CHAT_MAX_LENGTH}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              {draft.length > CHAT_MAX_LENGTH - 50 && (
                <span className="text-[10px] text-subtle tabular-nums" aria-hidden="true">
                  {CHAT_MAX_LENGTH - draft.length}
                </span>
              )}
              <EmojiPicker onPick={insertEmoji} returnFocus={inputRef} />
              <IconBtn
                type="submit"
                aria-label="Send"
                disabled={!canSend}
                title={canSend ? undefined : "joining the room…"}
                className="!w-7 !h-7 !text-primary disabled:opacity-40 disabled:cursor-wait"
              >
                <Icon.Send size={14} />
              </IconBtn>
            </form>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="people" className={panelCls}>
          {knocks.length > 0 && (
            <>
              <GroupHead count={knocks.length}>waiting</GroupHead>
              {knocks.map((k) => (
                <KnockRow key={k.userId} knock={k} onDecide={onDecideKnock} />
              ))}
            </>
          )}
          {groups.map(
            ([label, list]) =>
              list.length > 0 && (
                <Fragment key={label}>
                  <GroupHead count={list.length}>{label}</GroupHead>
                  {list.map((p) => (
                    <ParticipantRow
                      key={p.id}
                      p={p}
                      onOpenProfile={onOpenProfile}
                      moderation={moderation}
                    />
                  ))}
                </Fragment>
              ),
          )}
        </Tabs.Panel>

        <Tabs.Panel value="activity" className={panelCls}>
          {activity.length === 0 && <EmptyNote>nothing has happened yet.</EmptyNote>}
          {activity.map((a) => (
            <div
              key={a.id}
              className="flex gap-2.5 py-2 border-t border-dashed border-border-subtle first:border-t-0"
            >
              <span
                className={`w-[7px] h-[7px] mt-1.5 rounded-full flex-shrink-0 ${FEED_DOT[a.kind] ?? "bg-muted"}`}
              />
              <div className="text-[11.5px] text-fg-muted leading-normal">
                <span className="text-fg font-semibold">{a.who}</span> {a.what}
                <time
                  dateTime={a.at}
                  className="block mt-0.5 text-[10.5px] text-muted tabular-nums"
                >
                  {hhmm(a.at)}
                </time>
              </div>
            </div>
          ))}
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
};
