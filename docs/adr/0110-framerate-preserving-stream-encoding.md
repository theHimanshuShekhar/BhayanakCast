# ADR 0110: Preserve Stream frame rate over resolution

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

V1 captured and published a Stream with no encoding contract at all: the capture asked only for video and audio, the video track carried no content hint, and no sender parameters were ever set. Three consequences followed from browser defaults rather than from any decision.

Capture ran at the source's native resolution — commonly 1440p or 4K — with no frame-rate request, so a Chromium desktop supplied the largest picture and the lowest motion available. A screen-capture track with an empty content hint is treated by the browser as detail content, which selects a resolution-preserving degradation strategy: under bitrate pressure the encoder discards frames to keep pixels sharp. With no sender bitrate ceiling, the stream was additionally held near the browser's conservative screen-share default.

Together these made fast-moving content — games and video — collapse to single-digit frame rates while static content such as an editor looked correct. This inverted the product intent: a social screen-sharing room is watched for what is happening, not for text fidelity.

The audience is predominantly Indian and predominantly on roughly 100 Mbit symmetric fibre. Upstream bandwidth is therefore not the binding constraint; publisher encode capacity is. Encode cost scales with pixels times frame rate and is largely independent of the target bitrate, so bitrate policy cannot mitigate a publisher that cannot encode.

## Decision

A Stream targets 1080p60 and preserves frame rate over resolution.

Capture requests 60 frames per second as an ideal and 1920x1080 as a maximum. The dimension constraints are ceilings only: a larger source is downscaled in the browser's capture pipeline before the encoder sees it, and a smaller source — a shared window rather than a monitor — is carried at its own size and never upscaled or letterboxed.

The captured video track is marked as motion content, and every outbound sender prefers to maintain frame rate. Degradation is left entirely to the browser's congestion controller: it scales resolution down continuously as a link demands and back up as headroom returns. There is no application-level quality ladder, no `getStats` control loop, and no named quality rung.

Each outbound sender carries a fixed 8 Mbit ceiling, set once when its connection is created. The ceiling is per subscription and is not divided across watchers. Each directed subscription keeps its own independent congestion controller, so a watcher on a weak link degrades alone while other watchers of the same Stream are unaffected.

Codec negotiation is left to the browser. No codec is preferred, probed, or pinned.

Each Stream reports one observability sample about ten seconds after it starts: encoder implementation, quality-limitation reason, frame rate, and encoded frame dimensions. This is measurement only and feeds no control path.

## Considered options

- **An explicit 720p rung enforced by the application.** Rejected. The browser's congestion controller reacts in milliseconds from RTCP feedback the application cannot see, while a `getStats` poll reacts in seconds and would fight the built-in controller. It would also introduce hysteresis, flap thresholds, and a stateful subsystem for no guarantee the frame-rate preference does not already provide.
- **Dividing one upstream budget across watchers.** Rejected once the audience bandwidth was established. Division would throttle streams to solve contention that does not occur on a 100 Mbit uplink, and it does not reduce encode cost, which is the constraint that actually binds.
- **Preferring VP9 for its stronger screen-content coding.** Rejected. Whether a publisher has a hardware VP9 encoder is machine-dependent and unmeasured; a software VP9 fallback cannot sustain 1080p60 and would reproduce the exact frame-rate collapse this decision repairs. The browser default is the cheapest realtime encode and the least likely to become encoder-bound.
- **Probing codec support before connecting, with `MediaCapabilities.encodingInfo`.** Rejected. The specification permits — and browsers do — reporting a supported configuration as smooth and power-efficient until local encode statistics exist. The probe is therefore optimistic precisely on a first-ever Stream, so it would mislead exactly the weak machine it was added to protect.
- **Raising the initial bitrate by rewriting the SDP `x-google-start-bitrate` attribute.** Rejected. Starting above what a link can carry induces loss and a hard congestion-control cut, which is worse than the honest ramp it replaces. It is also a non-standard, browser-specific string rewrite inside the negotiation path, where a malformed edit fails a connection rather than degrading it, against ADR 0104's browser-native commitment and the direct-media reliability criterion.

## Consequences

- Fast-moving content holds 60 frames per second and loses resolution instead. Text and fine detail on a 1440p or larger source are softer than before, because capture is now capped at 1080p.
- Watchers of one Stream may see different resolutions simultaneously. This is intended: per-subscription adaptation protects a good connection from a bad one.
- The first several seconds of every Stream are visibly soft while congestion control probes upward from its conservative start. This is accepted, not mitigated.
- A publisher serving many watchers runs that many independent 1080p60 encodes. In a full room this may exceed consumer encode capacity, softening the Stream for every watcher. V1 accepts this as a limitation. Simulcast or a media server would address it and both fall outside ADR 0104's direct-media boundary; neither is in V1.
- If the observability sample shows publishers are encoder-bound rather than link-bound, the correct response reduces pixels — scaled resolution or a frame-rate cap per watcher count — not bitrate. That decision is deferred until the data exists.
- Direct connectivity remains the dominant risk to the launch reliability criterion, and this decision does not touch it. Carrier-grade NAT is widespread among the target audience and ADR 0104 ships without a TURN relay, so ICE outcome and selected candidate type deserve their own measurement and decision.
