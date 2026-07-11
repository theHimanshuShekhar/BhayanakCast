# ADR 0086: Use an open invitation when no rooms are live

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

A fresh or quiet community has no featured room or Live Room list. The empty center must explain the state and activate room creation without becoming a separate onboarding flow or relying only on rail actions.

## Decision

When no rooms are live and Home is not showing search results, replace the featured/list area with a generous but restrained text-led invitation panel. Lead with “The clubhouse is quiet,” explain public versus private room creation in one concise supporting passage, and provide a primary Create Room action.

Use no illustration, fake room content, multi-step onboarding, or decorative animation. The ten recent Past Streams remain immediately below when available. If there is no Past Stream history either, omit that section and include one short first-community cue in the invitation.

## Consequences

- The center remains useful on desktop and mobile even when rail actions are absent or collapsed.
- Anonymous visitors see the same invitation, but its Create Room action initiates Discord sign-in and returns to Home without creating a room automatically.
- Loading and filtered/search empty states use their own specific copy rather than this community-empty message.
