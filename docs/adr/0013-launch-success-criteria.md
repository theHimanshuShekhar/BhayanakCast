# ADR 0013: Use journey completion and direct-media reliability as launch criteria

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The rewrite needs observable launch criteria beyond feature completion. The selected priorities are core journey completion, realtime/media reliability, and qualitative community engagement.

## Decision

- At least 90% of a representative usability cohort must complete the core journey unaided: sign in; discover, create, or join a room; start or watch a stream; chat; and leave.
- At the ADR 0012 load target, at least 99% of watch attempts from the compatibility-supported population on consumer Wi-Fi/residential broadband and normal cellular networks must establish direct P2P media without manual retry.
- Community engagement is tracked qualitatively at launch; no numeric engagement threshold blocks launch.

## Consequences

- Safety, retention, and deletion behavior remain functional release requirements even though they are not selected as primary success metrics.
- ADR 0014 defines the compatibility-supported client population. Restrictive enterprise, school, and captive networks are outside the 99% denominator and must receive the compatibility-warning/recovery path rather than an implied relay fallback.
- Usability testing must recruit a defined representative cohort rather than internal implementers alone.
