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
