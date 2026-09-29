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
- Capture asks for at most 1920×1080 at 60 fps, the ladder's top rung; each peer's sender encodes at the rung its connection allows (see the adaptive quality addendum).
- Share audio is marked `music` and sent with `maxBitrate` 128 kbps. Browsers only encode stereo Opus at that rate when the receiving side asks for it, so the sender adds `stereo=1; maxaveragebitrate=128000` to the Opus parameters of its share-audio m-section in the remote description it applies. The mic stays at the browser's voice defaults.
- Everyone plays a share only while the server says the person is sharing, so a share a host, mod or admin stopped disappears for every viewer even if media still arrives (ADR 15).

## Addendum: adaptive quality and codecs (2026-09-29)
- **Ladders.** A screen share moves along 720p30 (1.5 Mbps), 900p30 (2.2), 1080p30 (3, the default), 1080p45 (4.5) and 1080p60 (6). A camera moves between 360p15 (the default, 500 kbps) and 180p15 (150 kbps). A rung is applied to one peer's sender with `setParameters` (`maxBitrate`, `maxFramerate`, `scaleResolutionDownBy` from the capture's height), so every viewer has a ladder of their own. A rung the capture can't feed (a 720p window; a 30 fps capture) is above the cap and never used.
- **Controller.** Every 4 s the Mesh reads each video sender's `getStats()` (bandwidth estimate, the bitrate actually sent, loss the receiver reports, round trip, the encoder's quality-limitation reason). `step` and `nextRung` (src/lib/quality.ts) are pure functions of the newest samples and the current rung.
  - *Pressure* is loss of 5% or more, a round trip of 500 ms or more, a CPU limit, or a bandwidth limit while the estimate is below 80% of what is being sent. Sending little (a still screen) is never pressure, and neither is a bandwidth limit that the rung's own `maxBitrate` puts on the encoder: Chromium's estimate only probes up to about the configured cap, so it says nothing about headroom above it.
  - It steps down after 2 pressured samples in a row, as far as the estimate says it must (net of what the peer's other video sender sends).
  - It steps up one rung as a probe after a window of 5 clean samples in a row (about 20 s), without asking the estimate for headroom. If the probe shows pressure, the step down brings it back and the next probe waits twice as long (up to 8 times the window); a probe that stays clean for a window resets the wait.
  - The window empties whenever the rung changes, and the first 2 readings of a new or resumed sender are ignored while the estimate ramps up. A rung is applied per sender one change at a time and checked against the encoding on every pass, so a refused change or a resized capture heals by itself.
  - **The thresholds and windows are provisional**, to be tuned after the real-world session (#52); CI only sees localhost.
- **Codecs.** Each side tells the other which video codecs it can decode, in its `hello` and its descriptions (MIME types only). Each side then orders its own senders' codecs with `setCodecPreferences`: AV1, VP9, H.264, VP8 (others after them, then retransmission formats), leaving out what the peer can't decode. It takes effect in the next offer; before the peer has spoken, everything is offered in the same order and the answer keeps the best codec both have. The result is the same whichever side hears the other first. The mixed Chromium↔Firefox choice is covered by unit tests only: e2e pairs are always the same browser. Browsers that lack a codec (Firefox without AV1) simply don't list it. Audio stays Opus. Signalling sizes stay far below the 64 KB cap (ADR 4 addendum): about 24 KB for Chromium's largest offer with all eight m-sections.
- **Dev overlay.** In development builds only (`import.meta.env.DEV`), the room shows each peer's current rung and codec at the bottom left of the stage. Production builds don't contain it.
