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
