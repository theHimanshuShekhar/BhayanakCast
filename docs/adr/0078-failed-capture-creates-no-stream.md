# ADR 0078: Keep failed capture attempts out of live Stream state

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

The browser display-capture picker may be cancelled, denied, unsupported, or fail before usable media exists. Publishing server-side Stream state before capture succeeds would create a false live tile and unnecessary cleanup.

## Decision

Own Stream uses one stateful control slot in the bottom shelf. `Start Stream` opens the native picker. Once usable tracks return, the slot shows `Starting…` with Cancel while local media/startup work completes. Submit the authorized `stream:start` command only after tracks and local setup are ready; its canonical acknowledgement changes the same slot to `Stop Stream`. Cancel before submission releases all acquired tracks and returns the slot to Start without creating server state.

A cancelled, denied, unsupported, or failed picker/local-startup attempt creates no Stream session, Stream Preview, peer connection, or room Activity start event. The Account remains a normal non-streaming Room Member with chat and any current remote watch unchanged. Show a specific safe inline error/recovery message, return the slot to Start Stream, and never reopen the native picker automatically. Mutation pending state prevents duplicate Start submission; TanStack Pacer is not involved.

## Consequences

- Server Stream creation happens only after the client holds usable browser-provided capture tracks and sends the authorized start command.
- Permission or compatibility failure does not remove room membership.
- If an already active Stream later loses its capture tracks, normal Stream-stop behavior applies instead.
