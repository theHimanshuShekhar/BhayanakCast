# ADR 0088: Make each Live Room card open pre-admission

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home cards have large preview and metadata surfaces. Requiring a small button as the only navigation target wastes that affordance, while joining directly from discovery would bypass the established admission boundary.

## Decision

A click or activation anywhere on a Live Room card navigates to that room's pre-admission page. The card is implemented as one accessible link target; category/tag/state chips within it are descriptive, not nested controls.

The destination performs pre-admission before rendering the admitted room layout. It exposes only the allowed room summary, state, and explicit Join action. Public and private admission, authentication, capacity, sanctions, ended-room handling, and room-switch validation remain at that boundary. Clicking a Home card never creates Room Membership, carries a private password, starts peer state, or subscribes media.

## Consequences

- The preview mosaic is an easy navigation target without pretending to play media on Home.
- Keyboard users receive one named card link with a visible focus state; the visual card can include an Open Room cue without adding a second action.
- Past Stream items continue to open their ended summary rather than using live pre-admission.
