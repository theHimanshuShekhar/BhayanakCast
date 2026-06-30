# Socket.IO room signaling

BhayanakCast will use Socket.IO for realtime room coordination and WebRTC signaling, with Socket.IO rooms as the server-side broadcast boundary for each BhayanakCast room. Socket.IO rooms let sockets join named channels and broadcast to that subset; multi-server deployment requires replacing the default in-memory adapter with a shared adapter such as Redis, Postgres, MongoDB, or Cluster.

## Consequences

- Socket.IO carries presence, chat, stream availability, WebRTC offers/answers/ICE candidates, host kick events, reports, and compatibility-gate state.
- Socket.IO does not carry stream media; stream audio/video remains peer-to-peer WebRTC.
- PostgreSQL persists product records such as rooms, past streams, transcripts, reports, accounts, and profiles; Socket.IO presence and stream subscriptions reset after a server restart.
- A single-node launch can use the default in-memory adapter, but horizontal scaling requires a shared Socket.IO adapter.
