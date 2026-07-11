# ADR 0029: Preserve every documented public URL path

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The rewrite redesigns the UI but retains the V1 functional product. Existing public room and profile links must remain meaningful during the clean implementation cutover.

## Decision

Preserve every documented public page and API path, including `/`, `/rooms/:roomId`, `/profile`, `/users/:userId`, `/admin`, authentication, health, thumbnail, and transcript endpoints. Keep opaque room and user identifiers in public URLs.

## Consequences

- The redesigned information architecture must fit the retained path contract rather than inventing replacement paths.
- Create Room and room settings remain in-place interactions rather than new public routes unless a later decision explicitly changes the contract.
- Route-level authorization and public projections remain enforceable independently of visual layout.
