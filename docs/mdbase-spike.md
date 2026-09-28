# mdbase spike — go / no-go (2026-09-28)

Question: can [mdbase](https://mdbase.dev/) (open spec, JSON Schema 2020-12 + CEL; reference
implementation `@callumalpass/mdbase`) replace the hand-rolled Zod engine as the core of
obsi-validate, the way TaskNotes built `mdbase-tasknotes` on it — **while the vault's
entity/property notes stay the single source of truth**?

Branch `feat/mdbase-spike`, package `@callumalpass/mdbase@0.3.0-rc.7` (no stable 0.3.0 on npm yet).

## Verdict

| Path | Verdict | Why |
|---|---|---|
| **CLI** (hooks, CI, `obsi-validate`) | **GO** | 100 % parity with Zod on the live vault and on the 40-case harness; 2× faster; nothing bespoke lost. |
| **Obsidian plugin** | **NO-GO for now** | Technically feasible (pure in-memory validator exists), but the package's `exports` map forbids a sub-path import, so the plugin would swallow all of mdbase: bundle 162 KB → ~700 KB and a `node:fs`/`node:path` dependency that breaks the mobile build. Revisit when upstream exposes a `validate`-only entry, or via a vendored copy of the JSON-Schema step. |
| **Full `_system/**` → `mdbase.yaml`+`_types/` migration** | **not opened** | Out of scope by design; the compile-step model (below) makes it unnecessary. |

Model that the spike validates: **notes = SSOT, `_types/` = generated artifact.** Nothing in
`_system/**` changes; `obsi-validate mdbase-export` compiles it. The property layer (191 notes
reused by name across 26 entities) is exactly what mdbase's flat one-file-per-type model cannot
express, and generation is what makes that a non-issue.

## Measurements

**Live vault** (4136 files, `--schema-dir /Volumes/mch/_system`), both engines:

| | Zod | mdbase |
|---|---|---|
| valid / invalid / skipped | 3305 / 302 / 529 | 3305 / 302 / 529 |
| files with diagnostics, identical (validity + error fields + warning fields) | 918 / 918 | |
| with `--check-links` (bespoke layer on top) | 2911 / 700 | 2911 / 700 |
| wall time | 1.26 s | 0.56 s |

**Harness** (`tests/mdbase/parity.test.ts`, 40 cases, both engines through `validateFile()`):

| category | match | category | match |
|---|---|---|---|
| enum | 4/4 | date | 2/2 |
| number | 3/3 | nullable | 3/3 |
| boolean | 2/2 | required_unless | 6/6 |
| required | 2/2 | link_constraints (bespoke) | 3/3 |
| unknown-field / allow_extra | 2/2 | expected_folder (bespoke) | 2/2 |
| property_patterns | 2/2 | type_key | 3/3 |
| list / links / any | 3/3 · 2/2 · 1/1 | **total** | **40/40** |

Go/no-go bar was ≥ 95 %. Skipped on purpose: task-intake detector and `--check-links`/inline
properties — bespoke code that runs byte-identically after the engine on both paths.

## Explicit answers (asked for by the schema owner)

**Dates.** gray-matter turns a bare ISO date into a `Date`; JSON Schema has no date type. Zod
accepts `Date` only for `date`/`datetime` properties (`z.union([string, date])`). The adapter
mirrors that: for those properties the `Date` is handed to mdbase as its ISO string; a `Date`
landing in a `string` property stays a `Date` and fails on both engines (11 `pages/2023-…` notes
with `name: 2023-03-10` — a real, pre-existing finding, not a parity artifact). Not a blocker.

**Link rules.** mdbase's `V03LinkRule` covers `target_type` + existence. Our
`target_folder`, `target_has_property`, `target_property_value` have **no equivalent**. They
stay bespoke in `validateLinkTarget()` — permanently, unless the spec grows them. Same for
`custom_validator` and `expected_folder`.

**CEL.** `TypeDefinition` takes expressions only in `match.expr` (type selection),
`collection.projections` (computed values) and `lifecycle.*.if` (write hooks). There is **no
record-level assertion hook**. So the task-intake detector (date-gated, procedural) cannot move
into the schema — consistent with the schema owner's ruling that transition rules are not shape
rules and do not belong in the schema anyway.

**`type_key`.** `settings.explicit_type_keys: [type_key]` works at runtime; an unknown value is
an `unknown_type` error, matching our "unknown type_key is an error" rule.

## What ships regardless of the verdict

- `obsi-validate mdbase-export` — deterministic, idempotent JSON-Schema export of the vault
  schema. Useful on its own for LSP/editor tooling, docs, and any non-Node validator.
- The `ShapeEngine` seam in `validateFile()` — the shape half is now a pluggable function; the
  Zod engine is the extracted default with unchanged behaviour (79 pre-existing tests untouched).
- `_deprecated/` schema exclusion in the CLI (parity with the plugin) — removed 43 false `pi`
  errors caused by a shadowing property file.
- Two engines that agree give the vault a regression oracle for free.

## Recommended next step

1. Keep `--engine zod` as the default until mdbase publishes a stable 0.3.0; keep the mdbase
   path green in CI (parity test) so the switch is a one-line default change.
2. Ask upstream for a `@callumalpass/mdbase/validate` sub-path export (pure JSON-Schema
   validation, no `Collection`/sql.js). That single change flips the plugin verdict.
3. Do **not** open a full `_system/**` migration: with the compile-step there is nothing to
   migrate — the notes already are the schema.
