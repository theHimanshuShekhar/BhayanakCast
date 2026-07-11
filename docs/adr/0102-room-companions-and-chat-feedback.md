# ADR 0102: Use persistent room companions with explicit chat feedback

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Chat, People, and Activity must remain available beside media without entering one undifferentiated feed. Chat also needs responsive send, unread, typing, failure, reporting, and mute behavior while preserving canonical server persistence and the bounded 50-message window.

## Decision

### Companion dock

The desktop companion dock opens on Chat. Chat, People, and Activity preserve their own room-session scroll state when switching tabs or collapsing the dock. Chat and Activity show unread badges while hidden. People shows the current member count rather than an unread concept.

People orders the current Host first, then `You` when different, then active streamers, then remaining members by continuous join time with stable display-name/identity tie-breakers. Reconnecting members remain in place with explicit status. Each row shows avatar/name, Host/You, streaming, compatibility/reconnecting, and sanction-relevant local capability state without exposing private enforcement reasons.

Activity begins empty on admission and presents only canonical events received afterward. It follows the latest event while already at the bottom; otherwise it preserves reading position and exposes a New activity cue. It remains visually and semantically distinct from member-authored Chat.

### Chat

First admission displays up to the 50 canonical persisted messages already defined, followed by realtime messages. Auto-scroll only while the reader is already at the bottom. If Chat is hidden or the reader has scrolled upward, preserve position, increment the unread badge, and show a New messages action that jumps to the latest. Read/unread state lasts only for the room session.

Sending creates a local Pending bubble immediately. The server acknowledgement replaces it with the canonical persisted message and canonical order. Other members receive only persisted canonical messages. Failure leaves a local failed bubble with Retry and Discard; it never appears in the transcript or to another member. Mutation/ack identity prevents duplicate canonical messages after Retry.

The composer is a plain-text multiline control. Enter sends, Shift+Enter inserts a newline, and mobile always exposes a Send button. Show the 500-character counter only as the limit approaches and keep validation/error text visible. Message menus provide Report for eligible targets and persistent chat Mute; mute immediately hides the muted Account's canonical history and realtime messages for that viewer while leaving all other room state unchanged.

### Typing presence

Show a named ephemeral indicator above the composer: up to two Discord display names plus `and N others are typing`. Begin when a member has non-empty input; stop on empty input, blur, send, leave, or disconnect; expire server-side after five seconds without refresh. Use TanStack Pacer `useThrottler` to send at most one typing refresh every two seconds with leading and trailing execution while retaining access to `cancel()` for terminal states. Typing state is Socket.IO live-only: never persisted, backfilled, added to Activity/Transcript, or sent to PostHog/log content. A viewer does not see typing indicators from Accounts whose chat they muted.

### Contextual actions

Every Stream Preview has a persistent footer with an explicit Watch button; its thumbnail and surrounding tile are not media actions. The same footer shows Streamer identity, Live/preview freshness, watcher stack/count, and a compact menu for Report and authorized Host actions. A watched tile's persistent footer exposes Stop Watching, Mute/Unmute, Fullscreen, connection/retry state, and the informational watcher stack/count. A non-streaming presence tile exposes the same Report/authorized-Host menu beside real identity and capability state. People rows expose the same member/Host actions so safety never depends on hover or a particular panel.

Own Stream start/stop remains only in the control shelf. Host actions remain scoped: stop another current Stream from its tile/People menu; kick, ban, or transfer Host from People/member menus with the documented confirmations. Header Settings opens a centered desktop dialog or full-screen mobile dialog with Metadata, Privacy, and Bans sections.

A report opens a responsive structured-report dialog while preserving the room. Submitting a report about the currently watched Stream stops only the reporter's local subscription and returns that tile to its current Preview with confirmation; the Stream continues for others pending moderation. Reporting another target does not imply mute, kick, ban, or departure.

## Consequences

- Chat feels immediate without claiming an unpersisted message is canonical.
- Typing presence adds ephemeral traffic but no retained content; Pacer and server expiry bound stale/chattery signals.
- Social and moderation actions are reachable from both media and People without flooding every tile with buttons.
- Companion tests must cover unread anchoring, draft/scroll preservation, pending canonicalization, retry de-duplication, typing expiry/mute, Activity separation, and report-driven local watch stop.
