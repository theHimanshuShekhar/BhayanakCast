# ADR 0017: Ship intentional light and dark themes

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The community-clubhouse direction must work for both daytime social browsing and evening media watching. A single default theme would impose the wrong ambient-light assumption on part of the audience.

## Decision

V1 ships both intentional light and dark themes. Each must preserve the same information hierarchy, privacy/safety state clarity, WCAG 2.2 AA contrast, focus visibility, and reduced-motion behavior.

## Consequences

- Theme tokens and component states must be designed, implemented, and tested in both modes rather than treating one as an inverted afterthought.
- The default-selection and persistent user-preference behavior remain to be decided.
- Media tiles may use a context-specific dark surface in either theme when it improves watching without weakening surrounding readability.
