# ADR 0049: Use 500-character plain-text chat with safe links

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Room chat needs to support normal social conversation and useful links without introducing a rich-content storage, rendering, and moderation system.

## Decision

V1 chat messages are normalized Unicode plain text, limited to 500 user-visible characters. Emoji remain text. The renderer linkifies only `http` and `https` URLs; links open in a separate browsing context with `noopener noreferrer` protections.

V1 does not support Markdown, images, GIFs, embeds, files, link previews, or other rich content.

## Consequences

- Server validation measures the same normalized user-visible length presented by the client.
- Stored messages remain text rather than rendered HTML; rendering must escape message content before linkification.
- Links remain reportable as part of their containing chat message.
