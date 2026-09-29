# 2. Room caps and adaptive stream quality

Date: 2026-09-27 · Status: accepted

## Context
Under the P2P mesh (ADR 1), each streamer uploads one copy of their screen share per viewer, so the streamer's uplink is the limiting factor.

## Decision
- Rooms cap at **10 people**, with at most **3 simultaneous streamers** (screen shares).
- Screen-share quality ladder: **low 720p30 → default 1080p30 → max 1080p60**, with intermediate steps.
- Quality is auto-negotiated and continuously adjusted per peer connection based on live connection stats (bandwidth estimate, packet loss, RTT), moving anywhere between low and max.
- Each peer pair negotiates the best codec both sides support (SDP codec preference ordering, e.g. AV1 > VP9 > H.264 > VP8, subject to hardware encode support).

## Consequences
- **Bandwidth assumption:** users have at least 25 Mbps symmetric, and on average 100 Mbps or more.
- Worst-case upload is a streamer sending to 9 peers: 1080p30 is roughly 2.5–4 Mbps per copy (~25–35 Mbps). Their camera and mic add ~5 Mbps. Average (100 Mbps) users comfortably sustain 1080p30, and often 1080p60. Users at the 25 Mbps floor adapt down towards 720p30 when streaming to a full room.
- Worst-case download is 3 streams at 1080p60 (~20 Mbps) plus 9 cameras (~5 Mbps), which fits within the floor.
- Because every link is a separate RTCPeerConnection, quality and codec can differ per viewer — a viewer on a bad link does not degrade others.
- Design copy mentioning "10–15 people" and 15-person capacities must change to 10.

## Addendum: cameras and mics
- Anyone in a room may turn on their camera. Camera default is 360p15, adaptively dropping to 180p under pressure.
- A camera track is paused towards any peer that is not currently rendering that tile (hidden viewers, collapsed layout).
- Mic audio uses Opus for every peer.

## Addendum: screen-share audio
Screen shares request audio through `getDisplayMedia`. Where the browser provides it (tab audio in Chromium; system audio on Windows), it is sent as a separate Opus track at ~128 kbps stereo with voice-processing (AEC/NS/AGC) disabled. Each viewer has their own volume control per share.

## Addendum: screen-share tuning (2026-09-29)
- A share starts only once the server accepts it (at most 3 streamers); the browser's screen picker opens after that, and a share the user cancels there ends at once.
- Browsers open the picker only within a few seconds of the user's click. The client waits at most 3 seconds for the server, and checks `navigator.userActivation` before opening the picker. If either is too late, the share ends and the user sees "couldn't start sharing — try again". A share the browser refuses otherwise (a cancelled picker) ends silently.
- **A cancelled share still counts.** The room saw it as LIVE from the server's acceptance, so it keeps its stream interval (a few seconds long) and its "started sharing" and "stopped sharing" feed entries. Not recording it would need another protocol step: the client would confirm capture before the hub opens the interval, and everyone's LIVE tile would wait for that. That isn't worth it for a few seconds.
- The share's video track gets a `contentHint` from the room kind: `motion` for gaming, watch-party and art rooms; `text` for code rooms; `detail` for music and chat rooms. Its sender's `degradationPreference` follows the hint: `maintain-framerate` for motion, `maintain-resolution` for detail and text.
- Capture asks for at most 1920×1080 at 30 fps, the ladder's default; the per-peer ladder adapts from there. Its 1080p60 rung (#37) needs the capture frame rate raised.
- Share audio is marked `music` and sent with `maxBitrate` 128 kbps. Browsers only encode stereo Opus at that rate when the receiving side asks for it, so the sender adds `stereo=1; maxaveragebitrate=128000` to the Opus parameters of its share-audio m-section in the remote description it applies. The mic stays at the browser's voice defaults.
- Everyone plays a share only while the server says the person is sharing, so a share a host, mod or admin stopped disappears for every viewer even if media still arrives (ADR 15).
