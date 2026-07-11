# ADR 0084: Show up to four Stream Previews on every live-room card

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Both the featured room and normal Live Room cards need to communicate what is currently being shared, while rooms can contain multiple simultaneous Streams and Home must preserve private-room preview treatment.

## Decision

Every Live Room card includes a preview region. With one to four active Streams, it displays their latest Stream Previews as a one-to-four-tile mosaic. With more than four active Streams, it selects the four freshest available preview images. Retained Streams keep their mosaic positions when the selected set changes where practical.

Public-room preview tiles are unblurred; private-room preview tiles are blurred. The larger featured card uses the same selection and privacy rules, with more visual area alongside its full room metadata/presence/action region. A room with no active Stream uses its presence, room state, and metadata rather than a fake media image.

## Consequences

- Card mosaics update when the server receives the normal two-minute preview refresh; Home never subscribes the visitor to peer media.
- Missing/failed preview images degrade per tile without hiding the room card or claiming the Stream ended.
- More-than-four overflow is indicated by the room's total active Stream count rather than rotating or paging the mosaic.
