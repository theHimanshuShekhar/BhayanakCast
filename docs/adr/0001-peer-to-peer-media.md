# Peer-to-peer media transport

BhayanakCast will use peer-to-peer WebRTC media for room streams: signaling uses the app's Socket.IO room protocol, while PeerJS or a similar client library may be used only if it preserves room-scoped authorization and materially reduces implementation complexity. Stream audio/video must not flow through an SFU or broadcast pipeline. This deliberately trades scalability and connection reliability for lower media-server complexity; TURN may be added later as a relay fallback for peers that cannot connect directly.

## Consequences

- Each streamer must send one media copy per subscribed viewer.
- Multiple simultaneous stream subscriptions increase streamer upload bandwidth and viewer CPU/bandwidth linearly.
- V1 rooms are capped at 10 members to keep peer-to-peer upload fan-out bounded.
- Failed direct connections use a compatibility-gate warning rather than TURN relay at launch.
- V1 supports starting streams only from Chromium-family desktop browsers. Modern Firefox and Safari may watch streams and use room chat when WebRTC compatibility allows, but they are not supported stream-capture browsers.
- Stream previews may send blurred thumbnail images through the server every two minutes; the server retains only the latest thumbnail for each active stream and deletes it when the stream ends. This is not a substitute for live audio/video transport and carries separate privacy/moderation obligations.
- Starting a stream does not show a separate thumbnail-specific consent notice; preview thumbnail upload is treated as part of the stream feature.
- Stream reports freeze the latest blurred thumbnail snapshot for platform-admin review.
