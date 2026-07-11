# ADR 0068: Let the browser picker choose captured audio

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Screen/application audio availability and user consent are browser- and source-dependent. An app-level audio control cannot reliably override the native capture picker and would add duplicate state.

## Decision

V1 requests display capture with audio when the browser supports it, then uses only the audio track the browser picker and user provide. There is no separate BhayanakCast audio setting, microphone capture, synthesized audio, or shared voice channel.

## Consequences

- A Stream may be video-only when the selected source/browser provides no captured audio.
- The UI must accurately reflect whether the active Stream includes captured audio rather than assuming it does.
- Audio follows the same direct peer-to-peer Stream transport and ends with the Stream.
