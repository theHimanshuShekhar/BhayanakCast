# Why one viewer sees every share blurry, and which levers fix it

Research for #91 (map #89, "Fix blurry streams for some viewers"). Written 2026-10-11 against the current W3C editor's drafts, libwebrtc `main`, Chromium `main` and mozilla-central tip. Claims are cited inline. **UNVERIFIED** marks a claim that no primary source backs. *Inference* marks a conclusion drawn from cited code but not stated in it.

Source shorthand:

- **S** = https://w3c.github.io/webrtc-stats/
- **P** = https://w3c.github.io/webrtc-provisional-stats/
- **PC** = https://w3c.github.io/webrtc-pc/
- **EXT** = https://w3c.github.io/webrtc-extensions/
- **SVC** = https://w3c.github.io/webrtc-svc/
- **CH** = https://w3c.github.io/mst-content-hint/
- **PRI** = https://w3c.github.io/webrtc-priority/
- **W:** = https://webrtc.googlesource.com/src/+/refs/heads/main/
- **C:** = https://chromium.googlesource.com/chromium/src/+/refs/heads/main/
- **M:** = https://searchfox.org/mozilla-central/source/

## Answer in brief

- **Each viewer has its own encoders, estimators and paths.** In this mesh, every share reaches a viewer through a separate peer connection. Each connection has its own encoder, its own congestion controller (GCC) and its own ICE path. Nothing coordinates the connections that arrive at one viewer.
- **So anything about that one viewer degrades every share reaching them, and only them.** That includes their downlink, their loss, their relay path and their browser or codec.
  1. Congestion or bufferbloat on their downlink lowers every sender's bandwidth estimate toward them.
  2. Loss takes retransmission and FEC overhead out of the encoder target, and triggers keyframes that reset quality on screen content.
  3. A relayed TURN path, especially over TCP or TLS, adds delay and route resets.
  4. The codec negotiated with their browser matters, and so does how that browser handles congestion control as a receiver.
- **What the blur looks like depends on the room kind.**
  - In `detail` and `text` rooms the sender keeps 1080p and raises QP (the compression level), so the picture goes soft or blocky at full size.
  - In `motion` rooms libwebrtc treats the share like a camera and lowers the resolution.
- **The decoder and jitter buffer don't cause blur.** They cause freezes and stutter.
- **The quality controller can't see the main case.** A bandwidth-starved `maintain-resolution` encoder reports `qualityLimitationReason: "none"`, and its send rate tracks the estimate, so the controller never sees pressure. It stays on its 1080p rung while the real encoder target is far below the rung's `maxBitrate`.
- **Distinguishing signals for telemetry:**
  - sender `targetBitrate` vs the rung's `maxBitrate`
  - average QP (Δ`qpSum`/Δ`framesEncoded`, per codec) with `frameWidth`/`frameHeight`
  - `pliCount`, `keyFramesEncoded`, `retransmittedBytesSent`
  - `remote-inbound-rtp` loss and RTT
  - the selected candidate pair's types and `relayProtocol`
  - receiver-side `inbound-rtp`, with the viewer's browser and version

## What the app does today (relevant facts)

- **Connections:** one `RTCPeerConnection` per pair (ADR 1). A screen share is encoded once per viewer.
- **Rungs:** applied per sender with `setParameters`, setting `maxBitrate`, `maxFramerate`, `scaleResolutionDownBy` from the capture height, and, for screens only, `degradationPreference` (`src/lib/mesh.ts` `#applyRung`). The ladder runs 720p30 at 1.5 Mbps to 1080p60 at 6 Mbps; the default is 1080p30 at 3 Mbps (`src/lib/quality.ts`).
- **contentHint by room kind** (`src/lib/local-media.ts` `shareHintFor`):
  - `motion` for gaming, watch and art rooms
  - `text` for code rooms
  - `detail` for the rest
- **Degradation preference:** `maintain-framerate` for `motion`, `maintain-resolution` for `detail` and `text` (`degradationFor`).
- **Codecs:** ordered AV1 > VP9 > H.264 > VP8 among those the peer can decode. `rtx`, `red`, `ulpfec` and `flexfec-03` are kept, last (`src/lib/codecs.ts`).
- **Controller inputs:** it reads only the following, every 4 s (`readSample`):
  - candidate-pair `availableOutgoingBitrate` and `currentRoundTripTime`
  - outbound-rtp `qualityLimitationReason`, `bytesSent` and `codecId`
  - remote-inbound-rtp `fractionLost`
- **What it does not use:** `targetBitrate`, `qpSum`, `frameWidth`/`frameHeight`, `pliCount`, retransmission counters, receiver-side stats, `jitterBufferTarget`, `scalabilityMode` or `priority`.
- **Production telemetry:** none, except the `[ice]` path log.

## 1. Mechanisms that blur every incoming share for one viewer only

Why this is per-viewer at all:

- Every `RTCPeerConnection` creates its own `Call` (`CreateCall_s`, W:`pc/peer_connection_factory.cc`).
- Each `Call` creates its own `RtpTransportControllerSend` with its own GoogCC controller (W:`call/rtp_transport_controller_send.cc`).
- The receiver sends transport-cc feedback per connection (W:`modules/congestion_controller/receive_side_congestion_controller.cc`).

No cross-connection coordination exists in this code.

### M1. Bandwidth estimate toward that viewer below the rung's `maxBitrate`

This is the leading candidate.

**How it works**
- GoogCC's delay-based part (trendline filter on the delay gradient, W:`modules/congestion_controller/goog_cc/trendline_estimator.cc`) and loss-based part (LossBasedBweV2, enabled by default, W:`modules/congestion_controller/goog_cc/loss_based_bwe_v2.cc`) lower the target.
- The target is clamped by `std::min(upper_limit, max_bitrate_configured_)` (W:`modules/congestion_controller/goog_cc/send_side_bandwidth_estimation.cc`).

**Why only this viewer**
- If the viewer's downlink is short, queued (bufferbloat, Wi-Fi) or lossy, every sender's estimate toward them falls on its own.
- The three shares (up to 6 Mbps each) and up to nine cameras all compete for that downlink with no shared budget. ADR 2's download sum is about 20 Mbps against a 25 Mbps floor, so a viewer below the floor, or with competing traffic, cannot carry it. *Inference.*

**What it looks like**
- Under `maintain-resolution` (`detail`/`text`), the QP scaler is off: "only enabled when the degradation preference is `MAINTAIN_FRAMERATE` or `BALANCED`" (W:`video/g3doc/adaptation.md`; code `IsResolutionScalingEnabled`, W:`video/adaptation/video_stream_encoder_resource_manager.cc`). The encoder stays at 1080p and QP rises: soft or blocky text at full size.
- Under `maintain-framerate` (`motion`), the quality scaler lowers resolution when QP is above the codec's thresholds: a smaller picture, upscaled on screen.

**The controller can't see it**
- `qualityLimitationReason` becomes `bandwidth` only when there are quality-driven resolution or framerate adaptations, bandwidth-limited layers, or an internal encoder scaler (`UpdateAdaptationStats`, W:`video/send_statistics_proxy.cc`).
- With the scaler disabled under `maintain-resolution`, a starved encoder keeps reporting `none`.
- Its `bytesSent` rate also follows the estimate, so `strained()` in `quality.ts` (estimate < 80% of sent) never fires. The pair keeps its 1080p rung while the encoder runs at a fraction of it. *Inference from the cited code and `quality.ts`.*

### M2. Loss on that viewer's path takes bitrate away from the picture

- The encoder target is the network target less protection: `encoder_target_rate_bps_ = fec_controller_->UpdateFecRates(...)`, then `protection_bitrate_bps_ = update.target_bitrate.bps() - media_rate` (W:`call/rtp_video_sender.cc`).
- The protection-overhead estimate (NACK retransmissions plus FEC) is capped at 50% (`kProtectionOverheadRateThreshold = 0.5`, "default is 50%", W:`modules/video_coding/fec_controller_default.cc`).
- A lossy viewer therefore gets a lower encoder target than their estimate alone implies, and the loss-based estimator lowers the estimate too.
- Only that viewer's connections retransmit, so only their streams lose the bits.

### M3. Loss leads to keyframe requests, which reset screen-content quality

**NACK and keyframe requests**
- The receiver NACKs missing packets once per RTT, up to 100 retries.
- If the NACK list would exceed 1000 packets it clears it and requests a keyframe (W:`modules/video_coding/nack_requester.cc`).
- An undecodable stream also leads to a PLI after the frame wait (W:`video/video_receive_stream2.cc`).

**What a keyframe costs on screen content**
- Keyframe size is capped (`MaxIntraTarget`, at least 300% of one frame's budget for VP8/VP9; AV1 `AOME_SET_MAX_INTRA_BITRATE_PCT 300`, in the codec wrappers under W:`modules/video_coding/codecs/`). So a keyframe is coded coarse and refined by later frames.
- libwebrtc says so for screen content: "The next frame encoded will be a key frame. Reset quality convergence so we don't get idle repeats shortly after, because key frames need a lot of refinement frames" (W:`video/frame_cadence_adapter.cc`, `ProcessKeyFrameRequest`).
- Quality convergence uses static QP thresholds VP8 15, VP9 32 and AV1 60; H.264 gets −1, which "will effectively disable the static QP threshold" (W:`video/quality_convergence_controller.cc`).

**Result:** a viewer whose loss causes repeated PLIs keeps resetting that pair's encoder to the soft post-keyframe state. Each keyframe also spends budget. Text that never sharpens is the expected symptom. *Inference*, though the reset itself is in the source.

### M4. That viewer's ICE path: relayed through TURN, especially over TCP or TLS

- A viewer behind a restrictive NAT or firewall is relayed on **every** pair.
- GoogCC has no TCP-specific logic. The route only changes per-packet overhead (W:`p2p/base/p2p_transport_channel.cc`).
- A network-route change resets the estimate to the start bitrate (`OnNetworkRouteChanged`, W:`call/rtp_transport_controller_send.cc`; start 300 kbps). After an ICE restart or a fallback to TURN, the pair ramps up from 300 kbps, soft at 1080p under `maintain-resolution`.
- Chromium's TCP socket queues writes instead of dropping them (`WriteOrQueue`, C:`services/network/p2p/socket_tcp.cc`). TCP or TLS relay loss therefore shows up as delay, which the delay-based estimator reads as congestion. **UNVERIFIED** as an end-to-end effect: it is an inference from that code, and no Google source states it.

### M5. That viewer's browser: codec and receiver-side congestion feedback

**Codec**
- Each pair's codec depends on what the viewer can decode.
- Firefox sends and receives AV1 only from about version 136 ([bug 1944878](https://bugzilla.mozilla.org/show_bug.cgi?id=1944878), [Firefox 136 notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/136)). Its AV1 decode is software (dav1d) by default (M:`dom/media/webrtc/libwebrtcglue/WebrtcVideoCodecFactory.cpp`).
- Older Firefox gets VP9.
- If a pair ever lands on H.264:
  - Chromium disables ULPFEC with NACK for codecs without a picture ID ("a waste of bandwidth", `PayloadTypeSupportsSkippingFecPackets`, W:`call/rtp_video_sender.cc`).
  - Quality convergence has no static threshold (M3).
  - Firefox advertises H.264 level 3.1 (`media.navigator.video.h264.level: 31`, "level 3.1", M:`modules/libpref/init/StaticPrefList.yaml`), which is about 720p. **UNVERIFIED:** whether a Chromium sender caps resolution to the remote level. I found no enforcement in W:`media/engine/webrtc_video_engine.cc` or W:`video/config/encoder_stream_factory.cc`.

**Firefox as receiver**
- It offers both transport-cc and REMB for video (M:`dom/media/webrtc/jsep/JsepCodecDescription.h`).
- There are known receiver-side estimation bugs:
  - REMB sent on only one video m-line ([bug 1576576](https://bugzilla.mozilla.org/show_bug.cgi?id=1576576), open)
  - REMB estimate broken after a libwebrtc update ([bug 1724065](https://bugzilla.mozilla.org/show_bug.cgi?id=1724065), open)
  - remote sender resolution collapsing for a Firefox receiver, fixed by adding audio transport-cc in about 152/153 ([bug 2041325](https://bugzilla.mozilla.org/show_bug.cgi?id=2041325), [bug 1654642](https://bugzilla.mozilla.org/show_bug.cgi?id=1654642))
- **UNVERIFIED:** whether any of these bugs applies to a Chromium-to-Firefox mesh pair with this app's SDP.

**Firefox's own screen content**
- Firefox does not implement `contentHint` (absent from M:`dom/webidl/MediaStreamTrack.webidl`).
- It encodes captures of screens, windows and browsers as screen content regardless (M:`dom/media/webrtc/jsapi/RTCRtpSender.cpp`).
- It honours `degradationPreference` from 138 ([bug 1329847](https://bugzilla.mozilla.org/show_bug.cgi?id=1329847)).

### M6. Display upscaling on that viewer's screen

**UNVERIFIED**, no WebRTC source covers it. A 1080p stream drawn full-screen or large on a 1440p/4K or high-DPI display is upscaled by the browser, so it looks softer than on a 1080p screen. The tile uses `object-contain` on the full tile (`src/components/room/screen-video.tsx`). This fits "every share blurry for some viewers" without any network fault, and it's cheap to rule out with telemetry (see below).

### Ruled out, or not blur

- **The decoder doesn't blur.** Decoders are normative. A slow decoder or a fall back to software causes stutter or freezes, not softness. The frame buffer only releases decodable, continuity-checked frames (W:`api/video/frame_buffer.cc`, W:`api/video_codecs/video_decoder_software_fallback_wrapper.cc`).
- **The jitter buffer doesn't blur.** It trades latency for loss recovery. Its failures show as `freezeCount` and `framesDropped`, not blur.
- **The receiver can't ask for less resolution.** It influences the sender only through transport-cc or RFC 8888 feedback (or REMB), RR loss and RTT, NACK, PLI/FIR, LNTF if negotiated, and `b=AS` in its SDP (W:`video/rtp_video_stream_receiver2.cc`; `b=AS` caps the sender via W:`call/rtp_bitrate_configurator.cc`).
- **A streamer-side cause would hit all of that streamer's viewers.** A CPU limit or a short uplink affects every viewer of that share, which is not the reported pattern. ADR 2's `UplinkBudget` already addresses the uplink.

## 2. getStats fields that tell the mechanisms apart

Definitions are from **S** (anchors `#dom-<dictionary>-<member>`, e.g. S#dom-rtcoutboundrtpstreamstats-qpsum). Firefox availability is from M:`dom/webidl/RTCStatsReport.webidl` and [MDN browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/RTCStatsReport.json).

| Mechanism | Sender side (that pair) | Receiver side (that viewer) |
|---|---|---|
| M1 low estimate | `targetBitrate` well below the rung's `maxBitrate`. `availableOutgoingBitrate` low. Average QP high. `frameWidth`/`frameHeight` at full size (detail/text) or reduced (motion). `qualityLimitationReason` `none` (detail/text) or `bandwidth` with `qualityLimitationResolutionChanges` > 0 (motion). Low loss. | `inbound-rtp` QP high, resolution as sent, `bytesReceived` rate low on **all** pairs at once |
| M2 loss overhead | `remote-inbound-rtp` `fractionLost`/`packetsLost` up. `retransmittedBytesSent` a large share of `bytesSent`. `nackCount` up. | `packetsLost`, `nackCount` (sent), `retransmittedPacketsReceived`, `fecPacketsReceived`/`fecPacketsDiscarded` |
| M3 keyframe churn | `pliCount`/`firCount` rising. `keyFramesEncoded` rate high. `hugeFramesSent` up. QP spiking after each keyframe. | `pliCount` (sent), `keyFramesDecoded`, `freezeCount`/`totalFreezesDuration`, `framesDropped` |
| M4 relayed path | Selected pair: local or remote `candidateType` `relay`. Local `relayProtocol` `tcp`/`tls`. `currentRoundTripTime` high. `roundTripTime` on remote-inbound. | Same candidate-pair fields on the viewer's own connections |
| M5 browser/codec | `codecId` → `codec.mimeType`. Average QP is only comparable within one codec (S defines the QP scale for VP8 only, 0..127). | `codec.mimeType`. `decoderImplementation`/`powerEfficientDecoder` (only shown when "exposing hardware is allowed", i.e. a capturing page). Browser and version from the user agent. |
| M6 upscaling | (sent size normal) | `inbound-rtp` `frameWidth`/`frameHeight` compared with the `<video>` element's rendered size × `devicePixelRatio` (a DOM value, not a stat) |

### Telemetry field list

Recommended, per pair, sampled with the existing 4 s pass.

**`outbound-rtp` (each video sender)**
- `targetBitrate`
- `bytesSent` and `headerBytesSent` (rate)
- `retransmittedBytesSent`, `retransmittedPacketsSent`
- `framesEncoded`, `qpSum` (→ average QP per interval)
- `keyFramesEncoded`, `hugeFramesSent`
- `frameWidth`, `frameHeight`, `framesPerSecond`
- `qualityLimitationReason`, `qualityLimitationDurations`, `qualityLimitationResolutionChanges`
- `nackCount`, `pliCount`, `firCount`
- `totalPacketSendDelay`
- `encoderImplementation`, `powerEfficientEncoder`
- `codecId` → `mimeType`
- the current rung, and the `degradationPreference`/`contentHint` in effect

**`media-source`**
- `width`, `height`, `framesPerSecond` (the capture, to compare with the sent size)

**`remote-inbound-rtp`**
- `fractionLost`, `packetsLost`
- `roundTripTime`, `totalRoundTripTime`/`roundTripTimeMeasurements`
- `jitter`

**`inbound-rtp` (each incoming video, on the viewer)**
- `bytesReceived` (rate)
- `framesDecoded`, `qpSum` (→ average QP)
- `keyFramesDecoded`
- `frameWidth`, `frameHeight`, `framesPerSecond`
- `framesDropped`
- `freezeCount`, `totalFreezesDuration`
- `packetsLost`, `packetsReceived`, `packetsDiscarded`
- `nackCount`, `pliCount`, `firCount`
- `retransmittedPacketsReceived`
- `fecPacketsReceived`, `fecPacketsDiscarded`
- `jitterBufferDelay`, `jitterBufferTargetDelay`, `jitterBufferMinimumDelay`, `jitterBufferEmittedCount`
- `totalDecodeTime`, `totalProcessingDelay`
- `decoderImplementation`, `powerEfficientDecoder`
- `codecId` → `mimeType`

**`candidate-pair` (selected, via `transport.selectedCandidatePairId`, or `selected` on Firefox)**
- `availableOutgoingBitrate`, `availableIncomingBitrate`
- `currentRoundTripTime`
- `bytesSent`, `bytesReceived`
- `packetsDiscardedOnSend`

**`local-candidate` / `remote-candidate`**
- `candidateType`, `protocol`
- `relayProtocol` (local relay candidates only)

**Context, not stats**
- the viewer's browser and major version
- the `<video>` rendered size × `devicePixelRatio`
- the number of shares and cameras being received

Derived values:

- **Average QP:** Δ`qpSum` / Δ`framesEncoded` (sender) or / Δ`framesDecoded` (receiver), compared only within one codec. **UNVERIFIED** in the spec: the commonly cited ranges, H.264 0..51 and VP9/AV1 0..255.
- **Starvation:** `targetBitrate` / rung `maxBitrate`.
- **Retransmission share:** Δ`retransmittedBytesSent` / Δ`bytesSent`.
- **Keyframe and PLI rates per minute.**
- **Downscale:** sent `frameWidth` / `media-source` `width`.

Gaps and caveats:

- **Firefox senders have no** `qualityLimitationReason`, `qualityLimitationDurations`, `targetBitrate`, `encoderImplementation` **or candidate-pair `availableOutgoingBitrate`/`availableIncomingBitrate`** (not in M:`dom/webidl/RTCStatsReport.webidl`). Receiver-side `inbound-rtp` is the common ground across browsers, so record both ends.
- Firefox has `currentRoundTripTime` from 142, and `freezeCount`/`totalFreezesDuration`/`jitterBufferTargetDelay` from 142 (MDN BCD). It has no `decoderImplementation`.
- `availableIncomingBitrate` exists only where a receive-side estimate (REMB) is computed (S), so it's usually absent with transport-cc.
- `networkType` is no longer in the main stats spec. It survives only in **P**, deprecated for privacy. `contentType` (screenshare or not) is provisional too (**P**).
- `fractionLost` is RTCP-RR loss before retransmission recovers anything, so it overstates the damage that reaches the decoder. *Inference from RFC 3550 semantics as cited by S.*

## 3. Levers per mechanism, and what the codebase already uses

| Lever | Counters | Source | In the codebase? |
|---|---|---|---|
| `contentHint` `detail`/`text` | M1 (keeps resolution: QP rises instead of downscaling) | CH: `detail`/`text` mean artefacts "that make small text or line art unintelligible should be avoided". Chromium maps them to screencast (`is_screencast = true`, W:`pc/rtp_sender.cc`), which turns on screen tuning (AV1 `AOM_CONTENT_SCREEN`, VP9 tune-content, zero-hertz/quality convergence) | **Yes**, by room kind. `motion` maps to `is_screencast = false` in the same file: a gaming or watch share is encoded as camera content, with no screen tools or convergence, and is downscaled under pressure. Firefox ignores `contentHint` and keys screen mode off the capture source |
| `degradationPreference` | M1 (choose blur-by-QP vs blur-by-downscale) | CH#dom-rtcrtpsendparameters-degradationpreference. Chromium honours an explicit value (`GetDegradationPreference`, W:`media/engine/webrtc_video_engine.cc`: "Do not adapt resolution for screen content as this will likely result in blurry and unreadable text"). Firefox from 138 | **Yes** (`degradationFor`). Neither value helps a starved pair; it only picks how the blur looks |
| Rung `maxBitrate` / `maxFramerate` / `scaleResolutionDownBy` | M1, M2, if driven by the right signal | PC#dom-rtcrtpencodingparameters-maxbitrate etc. | **Yes**, but the controller never reads `targetBitrate`, so it can't see M1 under `maintain-resolution` (§1, M1). **Lever:** treat `targetBitrate` ≪ rung `maxBitrate` (or high average QP) as pressure. For text, step framerate down before resolution (e.g. 1080p15), so a fixed bitrate buys more bits per frame. **UNVERIFIED** that this is sharper in practice: it's rate-control reasoning, and #89 lists it as an open tuning question |
| `scaleResolutionDownTo` | Same as above, orientation-agnostic | EXT `RTCRtpEncodingParameters` (new; overrides `scaleResolutionDownBy`) | No. Not needed |
| Codec choice (`setCodecPreferences`) | M3, M5 | AV1 and VP9 have screen-content tools and convergence thresholds; H.264 has neither convergence (W:`video/quality_convergence_controller.cc`) nor ULPFEC with NACK (W:`call/rtp_video_sender.cc`) | **Yes**, AV1 > VP9 > H.264 > VP8. **Lever:** put H.264 below VP8 for screens, or log when a pair lands on H.264 |
| Downlink budget per viewer (fewer or lower incoming streams when the viewer's link is short) | M1 | No platform lever exists: the receiver can't request resolution (§1, ruled out). It would be app signalling, like the existing camera pause | **Partly:** hidden cameras are paused toward a viewer (ADR 2). There is no downlink counterpart to `UplinkBudget` |
| `jitterBufferTarget` (receiver) | M3 (more time for retransmissions → fewer PLIs) | PC#dom-rtcrtpreceiver-jitterbuffertarget (0–4000 ms; "affects retransmissions and packet loss recovery"). Firefox from 115 | No. A cheap lever: a few hundred ms extra on screen receivers |
| NACK/RTX | M2, M3 | RTX counted in `retransmitted*` stats (S). Chromium NACKs by default | **Yes**, `rtx` kept in codec order |
| FEC (`red`/`ulpfec`, FlexFEC) | M2/M3 on high-RTT, lossy paths | Chromium uses ULPFEC only for VP8/VP9, and the hybrid NACK/FEC table turns it off at low RTT or small frames (W:`modules/video_coding/media_opt_util.cc`). FlexFEC sending needs the `WebRTC-FlexFEC-03` field trial (W:`media/engine/webrtc_video_engine.cc`). Firefox offers red/ulpfec by default and turns FEC off for H.264+NACK (M:`dom/media/webrtc/libwebrtcglue/VideoConduit.cpp`) | Kept in the codec list, but **not a usable lever** from the page: no API turns it on, and it costs up to 50% of the target (M2). **UNVERIFIED:** whether Chrome stable runs a field trial that changes this |
| `scalabilityMode` (temporal layers, e.g. `L1T2`/`L1T3`) | M3, maybe (losing a non-base temporal layer needs no keyframe) | SVC#dom-rtcrtpencodingparameters-scalabilitymode. The default "SHOULD be one of the temporal scalability modes". Firefox lacks it (M:`dom/webidl/RTCRtpParameters.webidl`) | No. **UNVERIFIED** that it reduces PLIs for this app's single-layer, single-receiver encoders |
| `priority` / `networkPriority` | Split within one pair (screen vs camera vs audio on the same transport) | PRI: `priority` "influences the bandwidth allocation among RTCRtpSender objects", relative within a transport only. Chromium's `BitrateAllocator` splits by `bitrate_priority` (W:`call/bitrate_allocator.cc`) | No. A small lever: setting the screen sender's `priority` above the camera's keeps the share's share of a starved pair |
| Minimum bitrate | M1 (keep a floor) | **No standard `minBitrate`** in PC, EXT, SVC, CH or PRI. Chromium's SDP `x-google-min-bitrate` is non-standard and **UNVERIFIED** here. A floor above the estimate only adds loss and delay | No. Not recommended |
| Path choice: prefer UDP relay, or TURN sooner on bad quality | M4 | `relayProtocol` (S); the route-change reset to the start bitrate (W:`call/rtp_transport_controller_send.cc`) means switching paths costs a ramp from 300 kbps | **Partly:** TURN is used only when P2P fails (ADR 3). #89 puts "TURN sooner on bad quality" in scope; check `relayProtocol` before preferring TCP/TLS relays |
| Rendering size | M6 | Not a WebRTC lever. Cap the drawn size at the decoded size, or tell the viewer the share is 1080p. **UNVERIFIED** as a cause | No |

## Unverified or open

- **TCP/TLS TURN harm:** that it degrades the bandwidth estimate through head-of-line queuing. This is inferred from Chromium's queuing TCP socket; no Google source states it.
- **H.264 level:** whether a Chromium sender honours Firefox's H.264 level 3.1 by capping resolution. I found no enforcement in the files checked.
- **Firefox receiver bugs:** whether bugs 1576576, 1724065 or 2041325 affect a Chromium→Firefox pair with this app's SDP.
- **QP ranges:** QP is spec-defined only for VP8. The H.264/VP9/AV1 ranges are folklore here.
- **Display upscaling (M6):** plausible, but unsourced.
- **Rate-control and resilience levers:** that framerate-for-resolution trades on text look sharper, and that temporal SVC reduces keyframe requests here.
- **Field trials:** whether Chrome stable runs field trials that change FEC or the degradation defaults.
- **Version numbers:** Firefox versions (AV1 136, `degradationPreference` 138, `currentRoundTripTime`/freeze stats 142, audio transport-cc about 152/153) come from Bugzilla and MDN BCD. Treat them as approximate. One source gave the hardware AV1 decode fix ([bug 2062642](https://bugzilla.mozilla.org/show_bug.cgi?id=2062642)) as 156 and another as 157.
- **Live checks:** none of this was checked against a live Chromium or Firefox session. The telemetry ticket should confirm, in particular, that `qualityLimitationReason` stays `none` for a starved `maintain-resolution` share.
