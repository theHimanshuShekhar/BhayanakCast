# Can a page tell whether WebRTC will hardware-encode a codec, before and during a share?

Research for ticket #126, part of map #125 ("Pick video codecs by what the streamer's machine can afford").
Researched 2026-10-21. Builds against the BhayanakCast contract in ADR 2 (codec order AV1, VP9, H.264, VP8 per pair through `setCodecPreferences`; the CPU limit as *pressure*; the quality telemetry rows), ADR 17 (Chrome, Edge and Firefox full support; Safari best-effort), `src/lib/codecs.ts` and `src/lib/mesh.ts`.

## Answer in one paragraph

Only Chromium (Chrome, Edge) can say anything useful, and what it says is *whether a hardware encoder exists for that codec*, not *whether the streamer's CPU can afford a software one*. Before a share, `navigator.mediaCapabilities.encodingInfo({type: "webrtc", ...})` is ungated and fast; on Chromium its `powerEfficient` is true exactly when the GPU process lists a hardware encoder profile for the codec (at the asked size and scalability mode). During a share, `encoderImplementation` and `powerEfficientEncoder` on the outbound-rtp stats are the live encoder's own report, but they are exposed only while the page is capturing (a streamer's page is). Firefox's `powerEfficient` is mostly software in disguise (true for any codec at 640x480 or below) and its stats carry neither field. Safari answers from a fixed per-codec table and carries neither stats field. `RTCRtpSender.getCapabilities` says nothing about hardware in any browser.

## How to read this document

- **Verified** = read in a primary source (spec text, browser source) or observed by running the browser here.
- **Inferred** = my reading of what verified facts imply.
- **Not verified** = listed at the end.
- Browser source was read from Chromium `main`, Firefox `main`, WebKit `main` and libwebrtc `main` on 2026-10-21. Where a release version is known it is stated. Source on `main` is newer than, or equal to, current stable; a given stable release may differ.
- Runtime checks ran on this Linux machine (no GPU encoders available): **Chromium 153.0.8010.12** (headless, Playwright) and **Firefox 155.0** (Playwright). They show the shape of the API and the gating; they cannot show what a machine *with* hardware encoders reports.

## The signals

### 1. `RTCRtpSender.getCapabilities("video")` (before a share)

- **Says:** which codecs the browser can send. Nothing about hardware or software.
- **Verified in source:** Chromium's encoder factory merges the software formats with the hardware formats into one list (`EncoderAdapter::GetSupportedFormats`, `video_codec_factory.cc`), so a codec is listed whether it would run in software or hardware.
- **Verified by running:** Chromium 153 lists VP8, six H.264 variants, AV1 `level-idx=5;profile=0;tier=0`, VP9 profile 0 and 2 (software-only machine). Firefox 155 lists VP8, VP9, AV1 and (here, with no OpenH264 plugin downloaded) no H.264.
- **Use:** only for "can this side send the codec at all", as `src/lib/codecs.ts` already does.

### 2. `navigator.mediaCapabilities.encodingInfo({type: "webrtc", video: {...}})` (before a share)

**Spec.** W3C Media Capabilities Working Draft, 18 October 2026. `MediaEncodingType` is `record` or `webrtc`. `scalabilityMode` applies to `webrtc` only. `powerEfficient`: "Encoding or decoding is considered power efficient when the power draw is optimal", "a common implementation strategy is to consider hardware usage as indicative of optimal power draw", and user agents "SHOULD NOT mark hardware encoding or decoding as power efficient by default" because software can be as efficient at low resolution. The spec ties no fingerprinting rule to `powerEfficient`, and the input has no content-type or screen-content member. (https://www.w3.org/TR/media-capabilities/)

**Support.** `encodingInfo` exists in Chrome and Edge 101, Firefox 63, Safari 15.4 (MDN browser-compat-data 8.1.6, 2026-10-15). That data does not say when the `webrtc` type arrived in each. What I could pin down:
- Chromium: `webrtc` has no runtime flag (`media_capabilities.cc`; only `record` is flagged). Works in 153 (run here).
- Firefox: `webrtc` behind `media.mediacapabilities.webrtc.enabled` in 152, on by default in **153**; the non-standard `transmission` alias was removed in 153 (MDN, Firefox 153 release notes). Works in 155 (run here).
- Safari: `webrtc` handled in WebKit's `MediaCapabilities.cpp` through `WebRTCProvider::createEncodingConfiguration`; I found no Safari release number for it.

**Gating.** None. No permission, no capture needed, no secure-context check on the encode path in Chromium. Ran here before any capture and returned values in all three browsers.

**What `powerEfficient` means in each:**

| Browser | `powerEfficient` for a video `webrtc` encode | Source |
| --- | --- | --- |
| Chromium | true iff the GPU process lists a hardware encoder profile for the codec, and (if the page passes `scalabilityMode` and size) that profile supports that mode and that size range. Otherwise the software factory is asked and `powerEfficient` is false. It does not look at CPU, load, framerate, bitrate or screen content. | `media_capabilities.cc`, `webrtc_encoding_info_handler.cc`, `video_codec_factory.cc` (`EncoderAdapter::QueryCodecSupport`), `rtc_video_encoder_factory.cc` (`QueryCodecSupport`) |
| Firefox | `hwSupported \|\| pixels <= 640x480`. Software encoding at 640x480 or below therefore reads as power efficient. And on desktop (`media.webrtc.encoder_creation_strategy` = 0) hardware is deliberately hidden whenever libwebrtc has a software encoder for the codec, which is always true for VP8, VP9 and AV1 (and for H.264 when the OpenH264 plugin is present). Android defaults to strategy 2 (platform hardware first). | `MediaCapabilities.cpp`, `WebrtcVideoCodecFactory.cpp`, `StaticPrefList.yaml` |
| Safari (WebKit) | A fixed table, not a probe: H.264 true, H.265 true, VP8 and VP9 false (`isVPXEncoderSmooth` returns false), AV1 false. `supported` is set true unconditionally in the override. | `LibWebRTCProvider.cpp`, `WebRTCProvider.cpp` |

**Verified by running (this machine, no hardware encoders):**
- Chromium 153: `powerEfficient` false for AV1, VP9, H.264, VP8, at 1920x1080 and 640x480; `supported` and `smooth` true for all four.
- Firefox 155: `powerEfficient` false at 1920x1080 but **true at 640x480 for AV1, VP9 and VP8** (software); H.264 `supported: false` (no OpenH264 plugin on the test profile).

**`smooth`.** On Chromium, when `powerEfficient` is true `smooth` is forced true (`WebrtcEncodeForceSmoothIfPowerEfficient`, default true). When it is false, `smooth` comes from Chromium's local WebRTC performance history database (`webrtc_history_service_->GetPerfInfo`, keyed on codec, pixels, framerate and the hardware flag). That is the only place in these APIs where "can this machine cope in software" could show up. **Inferred:** it is as good as the history on that device, which a fresh profile won't have; I couldn't test it. Firefox derives `smooth` from a rule (hardware, or a resolution/framerate bound in `IsWebRTCSWEncodeSmooth`), not from measurement.

**Cost.** Chromium: the first call waits for the GPU process to report its encoder support if not yet known (`NotifyEncoderSupportKnown`); the whole query is capped at a 10 s timeout, after which `powerEfficient` falls back to false. Measured here (no GPU encoders): first call 0.1 to 3.3 ms, repeat calls 0.1 to 0.4 ms; Firefox 0 to 7 ms. **Not verified:** the first-call wait on a machine with a real GPU stack.

### 3. `RTCOutboundRtpStreamStats.encoderImplementation` and `powerEfficientEncoder` (during a share)

**Spec.** W3C WebRTC Statistics, Candidate Recommendation Draft 25 September 2025 (and the current editor's draft). Both members: "MUST NOT exist unless exposing hardware is allowed", "MUST NOT exist for audio". `powerEfficientEncoder`: "Whether the encoder currently used is considered power efficient by the user agent. This SHOULD reflect if the configuration results in hardware acceleration", and the user agent "MAY take other information into account". `encoderImplementation`: "Identifies the encoder implementation used", a free-form string. (https://www.w3.org/TR/webrtc-stats/, editor's draft read at https://w3c.github.io/webrtc-stats/)

**Gating (verified, spec, source and run).**
- Spec section 6.1: "hardware capabilities should only be exposed in capturing contexts"; "exposing hardware is allowed" is true only if the *context capturing state* is true. The decision record is w3c/webrtc-stats issue #675 (closed 2022-09-27); the intent was "over-protective instead of under-protective".
- Context capturing state (mediacapture-main): false outside a `Window`; true if any capture track source in that window (microphone, camera or display) is not stopped and not muted and its device is live.
- Chromium implements exactly that: `ExposeHardwareCapabilityStats` in `rtc_stats_report.cc` is `window && IsCapturing(window)`, and gates `encoderImplementation`, `powerEfficientEncoder`, `decoderImplementation`, `powerEfficientDecoder` and `psnrSum`.
- Run on Chromium 153: with a canvas-captured track (no `getUserMedia`) both fields were **absent** from outbound-rtp; with a live `getUserMedia` camera track both were **present**.
- Consequence for this app: the streamer's page is capturing (it holds a `getDisplayMedia` track, and usually the mic), so it sees the fields. A page holding no live capture track does not. Stats read on a Worker are never exposed.

**Support.**
- Chromium: present in 153 (run here). I could not find the milestone it first shipped in: MDN's page for the field is 404, browser-compat-data has no entry for it, and the Chromium bug tracker and `git log` pages need a login or return 403. The spec-side gating was decided in September 2022.
- Firefox: **not exposed.** Firefox `main`'s `RTCStatsReport.webidl` `RTCOutboundRtpStreamStats` has neither field (nor `qualityLimitationReason`, which agrees with ADR 2). Confirmed on Firefox 155: outbound-rtp had neither. The Mozilla WPT sync bugs (1812582, 1818735) record these fields failing in Firefox.
- Safari: **not exposed** on the outbound side. WebKit `main`'s `RTCStatsReport.idl` `RTCOutboundRtpStreamStats` has neither field. (`decoderImplementation` and `powerEfficientDecoder` appear in `RTCStatsReport.h` only.)

**What the values are (Chromium; source).**
- libwebrtc fills `encoder_implementation` and `power_efficient_encoder` from the live encoder's `EncoderInfo` (`implementation_name`, `is_hardware_accelerated`) in `SendStatisticsProxy::OnEncoderImplementationChanged`, called from `VideoStreamEncoder` the first frame the info differs (`video_stream_encoder.cc`). So the stats follow a mid-share change within one frame plus your polling interval.
- Software encoders report fixed names: `libaom` (AV1; `is_hardware_accelerated = false`), `libvpx` (VP8 and VP9), `OpenH264` (H.264), observed here. Hardware encoders report the VEA's own name, for example `MediaFoundationVideoEncodeAccelerator (<hardware name>)` on Windows, with `power_efficient_encoder` true. Before the VEA reports, `RTCVideoEncoder` defaults to `ExternalEncoder` with hardware true. A `SimulcastEncoderAdapter` wrapper writes `SimulcastEncoderAdapter (<name>, ...)` and sets the hardware flag if any layer is hardware. The strings are not standardised; treat `powerEfficientEncoder` as the signal and the string as evidence to log.
- If the page asks for no stats before the first frame, the fields are absent (not "unknown").

**Cost.** `getStats()` on a sender: 0.2 to 0.3 ms in Chromium 153 here, 0 to 2 ms in Firefox 155. The fields come with the stats read the quality controller already does every 4 s, so the incremental cost is zero.

## Reliability

### Cases where `encodingInfo` says hardware and the share starts in software (Chromium; source)

`encodingInfo` and the real encoder are decided by different code. The query checks that a profile exists and (optionally) its scalability mode and size range. The real encoder (`RTCVideoEncoder::InitEncode`, `rtc_video_encoder.cc`) can still refuse and drop to the software encoder:
- **Scalability mode not supported by the hardware encoder.** If the sender asks for VP9 or AV1 temporal/spatial layers and the hardware profile does not list that mode, init returns software fallback. A page that calls `encodingInfo` without `scalabilityMode` gets `powerEfficient: true` from the same profile. (This app sets no `scalabilityMode` today: `src/lib/mesh.ts` has none.)
- **Low resolution.** Below 360p (below 270p for AV1) Chromium deliberately uses software (`UseSoftwareForLowResolution`, feature `kForceSoftwareForRtcLowResolutions`, on by default except Android) when a software fallback exists. `encodingInfo` called at a larger size does not predict this; called at the real size, it reports the hardware profile but the encoder still goes software at that size.
- **Size outside the profile's min/max**, **odd dimensions for H.264** (hardware H.264 needs even sizes), and hardware init errors (any `NotifyErrorStatus` sets software fallback; `Encode` then returns `WEBRTC_VIDEO_CODEC_FALLBACK_SOFTWARE`).
- **Where hardware encode exists at all.** Chromium on Linux gates hardware encode behind `kAcceleratedVideoEncodeLinux` ("AcceleratedVideoEncoder"), **disabled by default** in `media_switches.cc` on `main`. A Windows hardware path for AV1 exists in `media_foundation_video_encode_accelerator_win.cc` (and has vendor special cases: AMD limited to one temporal layer, Qualcomm AV1 software rate control disabled, a screen-content scenario setting for Intel only). I did not verify which GPUs or which stable release enable it, or the macOS AV1 situation.

### Mid-share fallback

- **Hardware to software mid-share is visible**, not silent, to a page that polls: the fallback wrapper reports the active encoder's info (`VideoEncoderSoftwareFallbackWrapper::GetEncoderInfo`) and the stats change on the next frame, so `encoderImplementation` flips (for example to `libaom`) and `powerEfficientEncoder` goes false. No event fires; detection is by polling. (Verified from source; I could not trigger a real fallback here.)
- **Software to hardware mid-share:** the same mechanism works the other way, but Chromium doesn't normally retry hardware.
- A secondary, non-primary source (real-time-media-architecture.com, "Detecting Hardware vs Software Encoding") claims a per-process cap on concurrent hardware encoders (3 to 4), a GPU-crash blocklist for the session, and an odd-size rule. The odd-size and crash-to-software behaviours match the Chromium source above; the session cap and blocklist I **did not verify in a primary source**. Under the app's mesh (ADR 1, one encode per viewer) a per-process cap would matter, so it is worth a targeted check before relying on `powerEfficient` for streamers with several viewers.

### Screen content specifically

- `encodingInfo` has **no** way to say "this is a screen share": the spec's video configuration has no content-type/hint member, and Chromium's handler receives only codec, size, scalability mode and framerate.
- The real encoders do get the content type: `RTCVideoEncoder` passes `kScreensharing` as the VEA's display content type; libaom switches to `AOM_CONTENT_SCREEN` and a different CPU speed ("Speed 11 is used for screen sharing", `libaom_av1_encoder.cc`); the Windows Media Foundation AV1 path enables the screen-content scenario for Intel only. So software cost and hardware behaviour for screen content can differ from a camera-style probe. **Inferred:** a `powerEfficient` answer for a camera-like configuration says the same for the share, but how well the encoder keeps up on text and motion isn't in it.
- Chromium does disable one screen-share hardware path: VP8 with temporal layers falls back to software under screenshare, behind `kWebRtcScreenshareSwEncoding` (off by default).

### What none of these signals tell you

- **CPU headroom.** `powerEfficient` and `powerEfficientEncoder` say hardware or not. A software encoder can keep up on a fast CPU, and a hardware path can still sit behind a CPU-bound capture or colour conversion. **Inferred** from the definitions; `qualityLimitationReason: "cpu"` stays the only direct overload signal, and only Chromium reports it (ADR 2).
- The Edge 155 session in #125: whether that AV1 was software is exactly what `encoderImplementation` would answer; the quality telemetry didn't record it, and I couldn't observe that machine.

## What this means for BhayanakCast

**Up-front codec pick (before the share).**
- **Chromium streamers:** possible, with `encodingInfo({type: "webrtc", video: {contentType: "video/AV1", width, height, framerate, bitrate}})` at the *real* capture size and the first step's frame rate, per codec, with no `scalabilityMode` (the app sets none). `powerEfficient: true` is a good sign the share will start in hardware, subject to the failure cases above. `powerEfficient: false` for AV1 means *libaom in software*, which is the cost the Edge 155 session likely paid (unconfirmed premise).
- The pick is "AV1 only if hardware" on Chromium, not "AV1 if the CPU copes": nothing before the share says the CPU copes. A software AV1 that is `smooth` per Chromium's perf history is a weak positive I couldn't validate.
- **Firefox streamers:** `powerEfficient` is not usable (true at 640x480 or below for software, false above; desktop Firefox is software for AV1, VP9 and H.264 by default). For desktop Firefox the answer is already known without any API: software. Android Firefox may use platform hardware.
- **Safari streamers:** the table says hardware for H.264 only, AV1 never; useful as a static fact, not a probe.
- Call `encodingInfo` once per codec at share start; the cost is negligible and ungated.

**During the share (telemetry).**
- On Chromium streamers, record per video sender row: `encoderImplementation` (verbatim string) and `powerEfficientEncoder` (bool), read from the same `getStats()` the controller already reads. They are present while the share runs, because the page is capturing.
- Absent on Firefox and Safari: store null, and let the telemetry's browser field carry the inference ("Firefox desktop = software").
- A change of either value mid-share is a fallback event worth its own record; windows already end at a codec change (ADR 2 telemetry addendum), and an implementation change deserves the same treatment so QP comparisons stay within one encoder.
- Also record the pre-share `encodingInfo` result (supported, powerEfficient) per codec for Chromium and Firefox, so the "predicted hardware, got software" gap is measurable from real sessions.
- Viewer pages (not capturing) will not see `decoderImplementation`; this map is about the streamer's encoder, so that does not matter here.

## Not verified

- Chromium release in which `encoderImplementation`/`powerEfficientEncoder` capture-gating shipped, and Chrome/Edge versions older than 153: no chromestatus or blink-dev entry found; the Chromium bug tracker and `git log` pages were not readable. Only 153 was run.
- Behaviour on a machine with real hardware encoders: all runtime checks were on a machine with none. `powerEfficient: true`, the hardware `encoderImplementation` strings, first-call latency with a real GPU process, and any live hardware-to-software fallback were read from source only.
- Which GPUs/OS versions enable hardware AV1 encode in Chrome and Edge for WebRTC, the macOS and Linux AV1 situation, and whether Edge differs from Chrome here.
- The claimed 3 to 4 concurrent hardware encoder cap and GPU-crash blocklist (secondary source only).
- Safari: version at which `encodingInfo` `webrtc` works, and real-device values; the WebKit result is from `main` source, not a Safari run.
- Chromium's perf-history `smooth` for software encodes: how it behaves on a fresh profile and whether it would flag a CPU-bound AV1 encoder.

## Sources

- W3C Media Capabilities (Working Draft, 18 October 2026): https://www.w3.org/TR/media-capabilities/
- W3C WebRTC Statistics (CRD 25 September 2025; editor's draft): https://www.w3.org/TR/webrtc-stats/ and https://w3c.github.io/webrtc-stats/ (members `encoderImplementation`, `powerEfficientEncoder`; section "Limiting exposure of hardware capabilities")
- W3C Media Capture and Streams, "Context capturing state": https://w3c.github.io/mediacapture-main/
- w3c/webrtc-stats issue #675, hardware fingerprinting: https://github.com/w3c/webrtc-stats/issues/675 (and #666, where the fields were proposed)
- MDN: `MediaCapabilities.encodingInfo()` (https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/encodingInfo); Firefox 153 release notes (https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/153); `@mdn/browser-compat-data` 8.1.6 (2026-10-15), read from the npm package
- Chromium source (`main`, 2026-10-21), https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ : `third_party/blink/renderer/modules/media_capabilities/media_capabilities.cc` and `.h`; `third_party/blink/renderer/platform/peerconnection/webrtc_encoding_info_handler.cc`, `video_codec_factory.cc`, `rtc_video_encoder_factory.cc`, `rtc_video_encoder.cc`; `third_party/blink/renderer/modules/peerconnection/rtc_stats_report.cc`; `media/base/media_switches.cc`; `media/gpu/windows/media_foundation_video_encode_accelerator_win.cc`
- libwebrtc source (`main`), https://webrtc.googlesource.com/src/+/refs/heads/main/ : `pc/rtc_stats_collector.cc`, `video/send_statistics_proxy.cc`, `video/video_stream_encoder.cc`, `media/engine/simulcast_encoder_adapter.cc`, `api/video_codecs/video_encoder_software_fallback_wrapper.cc`, `modules/video_coding/codecs/av1/libaom_av1_encoder.cc`
- Firefox source (`main`): `dom/media/mediacapabilities/MediaCapabilities.cpp`, `dom/media/webrtc/CodecInfo.cpp`, `dom/media/webrtc/libwebrtcglue/WebrtcVideoCodecFactory.cpp`, `dom/webidl/RTCStatsReport.webidl`, `modules/libpref/init/StaticPrefList.yaml` (`media.webrtc.encoder_creation_strategy`)
- WebKit source (`main`): `Source/WebCore/Modules/mediastream/RTCStatsReport.idl`, `Source/WebCore/platform/mediastream/libwebrtc/LibWebRTCProvider.cpp`, `Source/WebCore/platform/mediastream/WebRTCProvider.cpp`
- Mozilla Bugzilla WPT-sync bugs 1812582 and 1818735 (Firefox failing the hardware-capability stats tests)
- Secondary (not primary, used only for the unverified claims flagged above): https://real-time-media-architecture.com/media-handling-codecs-bandwidth-estimation/vp8-vs-h264-vs-av1-codec-selection/detecting-hardware-versus-software-encoding/
- Probe scripts and measurements: run locally with Playwright (Chromium 153.0.8010.12, Firefox 155.0); not committed.
