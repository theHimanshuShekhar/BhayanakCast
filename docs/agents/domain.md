# Domain Docs

This is a **single-context repository**. Engineering skills should use the root domain context and root architecture-decision directory when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repository root for BhayanakCast’s domain language, product constraints, and behavioral invariants.
- **`docs/adr/`** for architecture decisions relevant to the area being changed.

Read only the relevant sections and ADRs. Do not load the entire domain corpus when the task touches one bounded area.

If either location does not exist, proceed silently. Do not flag its absence or suggest creating documentation before it is needed. The `/domain-modeling` skill—reached through `/grill-with-docs` and `/improve-codebase-architecture`—creates or updates domain material when terminology or decisions are actually resolved.

## File structure

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-rewrite-product-baseline.md
│       └── ...
└── src/
```

There is no `CONTEXT-MAP.md` and no per-context `CONTEXT.md` layout. Unless the repository is deliberately migrated to a multi-context structure, consumers should not search for or invent subsystem context files.

## Use the glossary’s vocabulary

When output names a domain concept—in an issue title, specification, refactor proposal, hypothesis, or test name—use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent from the glossary, reconsider whether the output is inventing language the project does not use. If the gap is real, note it for `/domain-modeling`.

## Respect behavioral invariants

Treat confirmed rules in `CONTEXT.md` as implementation constraints. Before changing behavior:

1. Locate the relevant domain term or invariant in `CONTEXT.md`.
2. Read the ADRs governing that subsystem.
3. Verify that the proposed change is consistent with both.
4. Surface any conflict explicitly rather than silently overriding the documented decision.

## Flag ADR conflicts

If a proposed change contradicts an existing ADR, identify the specific ADR and explain why the decision may need to be revisited. For example:

> Contradicts ADR-0007 — worth reopening because the underlying constraint has changed.

Do not implement an incompatible architectural direction while leaving the existing ADR presented as current.
