# ADR 0090: Use adaptive filters with direct-first fuzzy search

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Room categories and tags are optional freeform metadata, so Home needs searchable controls rather than a large fixed chip cloud. Text search must support partial names and labels while still helping with misspellings.

## Decision

At wide and medium widths, Home shows a searchable single-select Category combobox and searchable multi-select Tags combobox beside or directly below the primary search field. At small widths, a Filters button opens an accessible bottom sheet containing the same controls. Selected filters remain visible as removable chips, with Clear all only when at least one filter is active.

Each combobox offers normalized distinct values found on current Active Rooms, with current matching-room counts. Typing searches those available options; it does not create arbitrary filter values.

A category filter requires one normalized exact category match. Multiple selected tags use AND semantics: a room must contain every selected normalized tag. These filters affect Active Room results only, including while a text query also returns Public Profiles.

Text search performs case- and Unicode-normalized direct matching first. Result precedence is exact name/identity, name/identity prefix, name/identity substring, then other direct category/tag matches. Conservative typo-tolerant matches follow all direct matches and apply only to queries of at least three normalized characters. V1 exposes no AND/OR switch, match-mode control, or separate suggestion flow.

## Consequences

- Desktop keeps useful discovery controls visible; small screens preserve space without changing filter semantics.
- Adding a tag always narrows or preserves the room result set.
- Direct matches remain predictable while fuzzy matching improves recall without outranking them.
- Empty and loading states must distinguish no room matches from no profile matches.
