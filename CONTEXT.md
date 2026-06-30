# BhayanakCast

BhayanakCast is a live screen-sharing product for small social streaming rooms. This glossary captures product language only; implementation choices live elsewhere.

## Language

**Public Discovery Platform**:
A product boundary where eligible live rooms and user profiles can be browsed beyond a user's existing friend graph. Discovery, moderation, privacy controls, and abuse handling are first-class product concerns.
_Avoid_: Private friend graph, closed crew app

**Account**:
A Discord-authenticated identity used for profiles, room membership, moderation, reports, and platform enforcement. V1 public identity mirrors Discord rather than using a separate BhayanakCast username.
_Avoid_: Local account, anonymous user

**Public Profile**:
An account page visible to other users that includes identity, aggregate usage stats, and social stats such as top co-users.
_Avoid_: Private profile, admin profile

**Public Room**:
A room that appears in discovery by default and can be joined by users until the room reaches capacity.
_Avoid_: Open room

**Private Room**:
A room that appears in public discovery but requires a shared per-room password before admission.
_Avoid_: Invite-only room

**Past Stream**:
A historical record of a room after it ends, limited to metadata such as title, host, participants, duration, and aggregate activity. It is not a replayable recording of the stream.
_Avoid_: Broadcast replay, recording

**Room Transcript**:
A retained chat record from a room, visible to the host and platform admins after the room ends. It is not part of the public past stream and does not backfill missed messages to reconnecting room members.
_Avoid_: Public chat replay, comments

**Room Member**:
A user currently admitted to a room, whether they are streaming, watching, or only chatting. Room capacity counts all room members.
_Avoid_: Seat, passive viewer

**Room Capacity**:
The maximum number of room members admitted to a room. V1 rooms have a hard capacity of 10 members.
_Avoid_: Viewer cap, audience size

**Reconnect Grace Period**:
The 60-second interval after a room member disconnects during which their room member slot remains reserved.
_Avoid_: Empty room grace period

**Host**:
The room member who currently owns the room. The host can moderate the room, including stopping member streams and applying room bans; host ownership passes to the longest-joined remaining member only after the current host leaves or exceeds the reconnect grace period.
_Avoid_: Streamer, admin, room moderator

**Room Ban**:
A host-applied restriction that prevents an account from rejoining a specific live room until the host clears the ban or the room ends.
_Avoid_: Kick, timeout

**Empty Room Grace Period**:
The five-minute interval after the last room member leaves during which the room remains live and joinable. If a user joins during this interval, they become the host; otherwise the room ends and becomes a past stream.
_Avoid_: Ended room, inactive stream

**Platform Admin**:
A trusted operator, identified by a static allowlist of Discord user IDs, who can enforce platform-wide safety decisions including ending rooms and applying platform sanctions.
_Avoid_: Host, moderator

**Platform Sanction**:
A platform-admin restriction on an account. V1 sanctions can block starting streams, sending chat, creating rooms, or all account access, and may be temporary or indefinite.
_Avoid_: Room ban, warning

**Report**:
A user-submitted safety signal about a room member, stream, or chat message. Stream reports include the latest blurred thumbnail snapshot for platform-admin review.
_Avoid_: Feedback, complaint

**Stream**:
A live screen or application share started by a room member, carrying captured video and any captured stream audio the browser provides. Other room members choose which active streams to watch.

An account can have at most one active stream in a room. Starting a new stream closes that account's previous active stream in the same room, preserving one stream per person. V1 room UI represents this as one Room Member Tile per member with either zero or one active stream state.

_Avoid_: Broadcast, camera feed

**Stream Subscription**:
A room member's explicit choice to watch one active stream. A room member may hold multiple stream subscriptions at the same time.
_Avoid_: Auto-watch, passive view


**Room Member Tile**:
A mosaic tile representing exactly one room member. Every admitted room member has one room member tile, whether streaming, watching, or only chatting.
_Avoid_: Seat tile, participant card

**My Stream Tile**:
The signed-in user's own room member tile. If not streaming, it offers starting a stream; if streaming, it shows local live preview and stream controls.
_Avoid_: Stream Preview

**Stream Preview**:
A non-subscribed active stream tile that uses the latest server-sent blurred thumbnail and a watch control. The thumbnail is refreshed every two minutes and signals that a stream exists without subscribing the viewer to remote stream audio/video.
_Avoid_: Autoplay preview, passive stream

**Compatibility Gate**:
A user-facing check that warns when a browser or network may not be able to stream or watch through direct peer-to-peer connections.
_Avoid_: TURN fallback, relay mode

**Shared Voice**:
A room-wide voice channel where members hear each other directly. BhayanakCast rooms do not include shared voice.
_Avoid_: Voice room, voice channel
