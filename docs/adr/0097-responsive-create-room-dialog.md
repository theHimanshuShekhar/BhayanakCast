# ADR 0097: Use a responsive in-place Create Room dialog

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home exposes Create Room from wide/medium navigation, the wide right rail, empty discovery, and small bottom navigation. The form must remain one shared flow without forcing a route or squeezing mobile fields into a desktop modal.

## Decision

Wide and medium layouts open the shared Create Room form in a centered accessible modal. Small layouts open the same form in a full-screen dialog that respects top/bottom safe areas and the on-screen keyboard. Both presentations keep identical field order, defaults, conditional private-password field, validation, explicit Cancel/Create actions, focus trap, Escape/dismiss rules, and focus return. Opening or cancelling does not change route.

An anonymous Create Room activation initiates Discord sign-in before showing the form. OAuth carries only an opaque create intent. On successful return to Home, reopen a blank authenticated Create Room dialog. Never carry room name, category, tags, visibility, or private password through OAuth, and never create until the Account explicitly submits valid form data.

Successful creation follows the existing atomic admission contract and navigates directly into the new room as Host. Failed creation keeps the dialog open with field/form error state and does not change current Room Membership.

## Consequences

- Every Home Create affordance invokes one form/validation contract.
- Mobile gets usable keyboard and error space without a separate route.
- Anonymous intent survives authentication without persisting sensitive or stale draft fields.
- Dialog behavior requires focused keyboard, focus-return, small-screen keyboard, OAuth return, and current-membership failure tests.
