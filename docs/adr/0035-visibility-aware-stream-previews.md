# ADR 0035: Use unblurred public-room and blurred private-room previews

- **Status:** Accepted
- **Date:** 2026-07-10
- **Amended:** 2026-07-29 — a private-room preview's blur is a property of the stored image, not of its presentation: private previews are captured and stored at most 64px wide, and the server enforces that cap by reading the WebP header.

## Context

An unsubscribed Stream Preview signals that a member is live without creating a media subscription. Its image treatment must match the room's privacy boundary.

## Decision

Public-room Stream Previews use unblurred thumbnails. Private-room Stream Previews use blurred thumbnails. The inherited V1 cadence and lifecycle remain: previews refresh every two minutes, only the latest active preview is retained live, and a stream report may freeze the latest preview as evidence.

The browser enforces the upload cadence with TanStack Pacer `useAsyncThrottler` configured for 120 seconds with leading and trailing execution. The first usable preview may upload immediately; captures inside the window collapse to the latest value. Stream stop/leave/unmount cancels pending work and aborts an in-flight upload. This client pacing does not replace the server's thumbnail validation or Valkey rate limit.

Blur applied in the browser is a presentation choice, and a preview key resolves to bytes for anyone who holds it. A private-room preview is therefore blurred as a property of the file: it is captured and stored at most 64px wide, against 640px for a public-room preview. The server enforces the cap rather than trusting the capture, reading the canvas size out of the WebP container header without decoding the image, and refuses an upload that exceeds the room's width. Presentational blur still applies on top, over an image that carries nothing legible to begin with.

## Consequences

- Starting a public-room stream makes its current screen/application preview intentionally visible to other admitted room members without a subscription.
- Private-room previews preserve the existing blurred indication of stream availability.
- Preview bytes remain excluded from logs and PostHog regardless of room visibility.
- A private-room preview cannot be recovered into a readable thumbnail by any client, including one that ignores the styling, because the detail was never encoded.
- A room turning private retires the previews its live Streams stored under the public rule, in the same transaction as the visibility change; waiting for the next upload would keep readable thumbnails of a now-private room servable for up to two minutes. The reverse direction needs nothing: a private-width preview is merely coarse.
- Serving a preview is not membership-gated, since Home shows previews to visitors who have joined nothing (ADR `0084`); the stored image, not the request, is what carries the privacy boundary. A key serves only while its Stream is live.
