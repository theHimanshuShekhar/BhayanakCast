# ADR 0015: Redesign the product UI

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The preserved V1 functional contract came with a dense dark “Live Signal Deck” visual system. The rewrite is not required to retain that aesthetic.

## Decision

Redesign the product UI from first principles. The redesign must preserve functional semantics, state legibility, keyboard operation, visible focus, WCAG 2.2 AA contrast, reduced-motion behavior, and mobile watch support, but it does not inherit the former visual identity, component styling, or layout language.

## Consequences

- A new design brief and design system are required before interface implementation.
- Existing prototype images and design tokens are historical reference only, not acceptance criteria.
- Product terminology and safety/private/live state must remain explicit regardless of the new visual direction.
