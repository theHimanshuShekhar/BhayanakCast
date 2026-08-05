# ADR 0013: Use journey completion and direct-media reliability as launch criteria

- **Status:** Accepted
- **Date:** 2026-07-10
- **Amended:** 2026-08-05 — the 90% unaided-completion cohort study is no longer a V1 launch gate. BhayanakCast is a hobby project, and a recruited representative cohort with consent, a separate observer, and per-session scoring is disproportionate to that scope. The journey itself is still required to work; what is dropped is the formal measurement. Revisit if the project takes on users who did not choose to be early adopters.

## Context

The rewrite needs observable launch criteria beyond feature completion. The selected priorities are core journey completion, realtime/media reliability, and qualitative community engagement.

## Decision

- The core journey must work unaided — sign in; discover, create, or join a room; start or watch a stream; chat; and leave — but V1 does not gate launch on a measured completion rate over a recruited cohort. Confidence comes from the ADR 0106 browser journey matrix plus operator walkthrough. **(Amended 2026-08-05; the original 90% cohort threshold is withdrawn.)**
- At the ADR 0012 load target, at least 99% of watch attempts from the compatibility-supported population on consumer Wi-Fi/residential broadband and normal cellular networks must establish direct P2P media without manual retry. **(Amended 2026-08-05: this is a monitored post-launch metric, not a pre-launch gate. Sampling real consumer networks with real devices is not a property of this repository; #27 repaired the watch instrumentation so the rate is computable from the self-hosted PostHog deployment, and the accepted risk is recorded there. PostHog outage drops analytics without replay, so the metric is best-effort by design.)**
- Community engagement is tracked qualitatively at launch; no numeric engagement threshold blocks launch.

## Consequences

- Safety, retention, and deletion behavior remain functional release requirements even though they are not selected as primary success metrics.
- ADR 0014 defines the compatibility-supported client population. Restrictive enterprise, school, and captive networks are outside the 99% denominator and must receive the compatibility-warning/recovery path rather than an implied relay fallback.
- The cohort study protocol is kept in `docs/operations/usability-qualification.md` and stays runnable, but as a post-V1 exercise rather than a release blocker. It is retained rather than deleted because the cohort definition, consent script, and computed acceptance are the expensive parts to rebuild; if the study is ever run, its own exclusion rules still apply.
