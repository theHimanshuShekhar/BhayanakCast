# ADR 0079: Lead Home with search and discovery controls

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home is the recurring room-discovery workspace, not a marketing landing page. Live Rooms must remain close to the top while users can quickly find an Active Room or public profile.

## Decision

The center column begins with a prominent search field, with room category/tag filters adjacent or immediately below as space permits. Live Rooms follow directly—including the featured room—then the ten recent Past Streams. V1 has no center-column title/create toolbar, promotional hero, or tall welcome panel above discovery.

Search results visibly separate Active Rooms from public profiles. Clearing search returns to the normal ranked Live Rooms section followed by ten recent Past Streams.

## Consequences

- Desktop and mobile preserve the same control order even when the toolbar wraps or stacks.
- Create Room remains prominent in the persistent left sidebar and signed-in right-rail action section without displacing discovery content.
- Anonymous visitors can search and browse; participation actions still route through Discord sign-in and explicit admission.
