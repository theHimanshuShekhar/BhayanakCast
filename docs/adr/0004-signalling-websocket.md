# 4. Signalling, presence and chat over a WebSocket in the app server

Date: 2026-09-27 · Status: accepted

## Decision
The app server process hosts a WebSocket endpoint. It carries:
- WebRTC signalling (SDP offers/answers, ICE candidates) between peers
- room presence (join/leave, mic/cam/share state, speaking)
- chat and reactions fan-out

Live room state is held in memory in that process. Durable events (room created/ended, user joined/left, stream started/stopped) are written to Postgres.

## Consequences
- No extra realtime service to run. A single server instance is the scaling unit; horizontal scaling would need a pub/sub layer (e.g. Postgres LISTEN/NOTIFY or Redis). Not needed at friend-group scale.
- A server restart drops live room state; clients must reconnect and re-announce themselves (rooms self-heal from clients).
- Chat passes through the server, so late joiners can be sent recent in-memory history even though chat is never persisted.

## Addendum: chat history for late joiners
The server keeps a ring buffer of the **last 50 chat messages** per live room in memory and sends it to each joiner. It is discarded when the room ends or the server restarts. Chat is never written to Postgres.

The room's **feed** (joins, leaves, share starts and stops, role and host changes, kicks, reactions) works the same way: the server logs the last 50 entries per live room in memory, sends them newest first to each joiner, and discards them with the room or on restart. Reactions are relayed and logged in the feed but never written to Postgres.

## Addendum: implementation and restarts (2026-09-27)
- The server uses the `ws` library on the HTTP server's `upgrade` event. The protocol is JSON with zod-validated discriminated unions shared by client and server.
- After a server restart, rooms stay live in the DB. Clients auto-reconnect and re-announce their state, and roles are restored from the DB. Rooms nobody returns to within 5 minutes end at their last-seen time (ADR 14). Peer-to-peer media keeps flowing during the blip.
- Home and lists load through route loaders and TanStack Query. The socket pushes invalidation events so lists and counts update live.

## Addendum: speaking is local, signalling is relayed opaquely (2026-09-29)
- **Speaking** does not go over the socket, despite the presence list above. Each client measures it itself with WebAudio analysers on the audio it receives (and on its own mic), so rings and waves need no server round trip and nothing about speaking is sent or stored.
- **Signalling** (`signal {to, payload}`) is relayed without being read, only between two current members of the same room, and rate-limited per sender (`SIGNAL_RATE_LIMIT`).

## Addendum: client messages up to 64 KB (2026-09-29)
Client messages were capped at 16 KB, but SDP offers outgrew it once screen sharing (#36) added the screen and share-audio tracks: one pair's connection carries up to eight m-sections (four slots each way), and Chromium's offer for all of them is about 24 KB, most of it the video codec list it offers per m-section. The cap (`MAX_CLIENT_MESSAGE_BYTES`, the `ws` `maxPayload`) is now **64 KB**.
- The size is bounded: a connection is between two people, so an offer never has more than eight m-sections however full the room is. 64 KB leaves room for candidates gathered into a re-sent offer and for codecs that browser updates add.
- Trimming the SDP instead (`setCodecPreferences`, header extensions) would decide which codecs each pair can use, which belongs to the per-pair codec preference (ADR 2), and Firefox can't trim header extensions.
- The server's cost stays small: `ws` holds at most one message per socket while reading it, the payload is validated by zod and relayed to one peer, and signalling stays rate-limited per sender (`SIGNAL_RATE_LIMIT`). The worst case a sender can push through the relay rises from about 0.6 MB/s to 2.6 MB/s, only to people in their own room.
