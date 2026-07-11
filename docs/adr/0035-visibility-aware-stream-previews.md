# ADR 0035: Use unblurred public-room and blurred private-room previews

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

An unsubscribed Stream Preview signals that a member is live without creating a media subscription. Its image treatment must match the room's privacy boundary.

## Decision

Public-room Stream Previews use unblurred thumbnails. Private-room Stream Previews use blurred thumbnails. The inherited V1 cadence and lifecycle remain: previews refresh every two minutes, only the latest active preview is retained live, and a stream report may freeze the latest preview as evidence.

The browser enforces the upload cadence with TanStack Pacer `useAsyncThrottler` configured for 120 seconds with leading and trailing execution. The first usable preview may upload immediately; captures inside the window collapse to the latest value. Stream stop/leave/unmount cancels pending work and aborts an in-flight upload. This client pacing does not replace the server's thumbnail validation or Valkey rate limit.

## Consequences

- Starting a public-room stream makes its current screen/application preview intentionally visible to other admitted room members without a subscription.
- Private-room previews preserve the existing blurred indication of stream availability.
- Preview bytes remain excluded from logs and PostHog regardless of room visibility.
