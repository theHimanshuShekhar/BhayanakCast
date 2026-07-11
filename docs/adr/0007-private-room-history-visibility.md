# ADR 0007: Apply public-profile visibility to private-room history

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Private rooms hide participant identities during public discovery and require a shared password for admission. Public profiles expose Past Stream history and top co-users. Those rules otherwise conflict for private-room participation.

## Decision

Private-room participation follows the same public-profile projection as public-room participation after it becomes historical. A private room's participation may appear in public Past Stream history and contribute to top co-user relationships.

## Consequences

- Private-room privacy protects pre-admission live discovery, not historical identity association.
- The UI and privacy copy must state this distinction clearly; the password is not anonymity.
- The profile projection must apply the same history/aggregate rules consistently to both room visibility types.
