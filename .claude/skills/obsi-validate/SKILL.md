---
name: obsi-validate
description: Validate Obsidian vault frontmatter and body wikilinks with the obsi-validate CLI, and author the schema it validates against — add or fix an entity/property file when validation rejects a legitimate field. Use when notes fail validation, when a new note type or field needs a schema, when wiring validation into CI or an agent hook, or when a "green" validation run needs to be trusted.
---

# obsi-validate — run it, read it, author the schema behind it

This repo is both an Obsidian plugin and a standalone CLI. The CLI runs the same
validation engine outside Obsidian, which is what makes it usable from CI and from
agent hooks.

**Schema lives in the vault, not in config.** Entity and property files *are* the
schema. Fixing a validation failure means either fixing the note or fixing the
schema — and knowing which is the whole skill.

## 1. Run it

```bash
# one file, frontmatter + body wikilinks
obsi-validate "<file.md>" --check-links --vault-dir <vault> --schema-dir <vault>/<schema>

# a folder
obsi-validate "<dir>" --check-links --vault-dir <vault> --schema-dir <vault>/<schema>

# machine-readable, for scripts and hooks
obsi-validate "<path>" --check-links --vault-dir <vault> --schema-dir <vault>/<schema> -f json

# only one entity type
obsi-validate "<path>" -t task --vault-dir <vault> --schema-dir <vault>/<schema>
```

Flags, config file, resolution order, JSON shape, library API → `docs/cli.md`.
Do not restate them here; that file is the source of truth.

## 2. Read the output — three outcomes, not two

| Output | Exit | Meaning |
|---|---|---|
| `✗ field: …`, `Invalid: N>0` | 1 | Real failure. Either the note is wrong or the schema is. |
| `⚠ field: …`, `Invalid: 0` | 0 | Warning. Counted as **Valid**. Passes CI silently. |
| `Skipped: N` | 0 | File had no recognizable entity type — **not validated at all**. |

The last two rows are where wrong conclusions come from.

### The trap that matters

An **unknown `type_key` is a warning, not an error**. Verified 2026-07-30:

```
---
type_key: totally_made_up_xyz
---
→  ⚠ type_key: Unknown entity type: totally_made_up_xyz
   Total: 1 | Valid: 1 | Invalid: 0    exit 0
```

A typo in the type name makes a note pass with a clean bill of health, because
nothing knows what to check it against. So:

> **A green run proves nothing until you know the file was actually checked
> against the type you expected.** Read `Valid` *and* `Skipped` *and* the warning
> lines — never just the exit code.

If you need unknown types to block (agent hooks usually do), detect that specific
warning yourself from `-f json` output and fail on it. The CLI will not do it for you.

### Checking exit codes correctly

```bash
out=$(obsi-validate "$f" --check-links --vault-dir "$V" --schema-dir "$S" 2>&1); code=$?
```

Not `obsi-validate … | tail -3; echo $?` — in a pipeline `$?` is the **last**
command's status, so the validator's code is lost and every file looks like a pass.
(Cost a wrong reading of all three test cases on 2026-07-30 before it was caught.)

## 3. Fix a note vs. fix the schema

Validation failed. Decide which side is wrong **before** editing:

- The field is a typo, a stale enum value, a string where a list belongs
  → fix the note.
- The field is legitimate and the schema simply does not know it yet
  → fix the schema. Never silence a real field by deleting it from the note.
- `allow_extra: false` on the entity is what turns "unlisted field" into a warning.

### Authoring entity and property files

Format, field-by-field: **`docs/schema-reference.md`** — entity/property frontmatter,
`extends` inheritance, link constraints, custom validators, all supported types.
Read it before writing a schema file; it is the contract, this section is only the
workflow around it.

The shape in one glance:

```
{schema_dir}/entities/task_entity.md      entity_name: task    ← matches type_key in notes
{schema_dir}/properties/status_property.md property_name: status
```

Rules that bite if missed — each verified against the CLI on 2026-07-30, not read off the docs:

1. **Frontmatter makes a schema file, not the filename.** A file under `entities/` is
   loaded as an entity only if it has `entity_name` or `properties` (`src/schema.ts:78`).
   Renaming `alive_entity.md` → `no-suffix-here.md` changed nothing. The `_entity.md`
   suffix is only a fallback for deriving the name when `entity_name` is absent.
   Corollary: prose/tombstone notes sitting in `entities/` are harmless — they are ignored.
2. **`entity_name` is what notes put in their type field**, not the filename prose.
3. A property must exist before an entity may require it.
4. **`_deprecated/` does NOT retire a schema for the CLI.** The Obsidian plugin skips
   that folder (`src/bridge.ts:33`); the CLI walker skips only `_archive` and `_skill`
   (`src/cli.ts:36`). Proven: an entity in `entities/_deprecated/` still resolves for
   `obsi-validate`, while an undefined type in the same run warns. So archiving through
   the plugin UI hides a type from the UI but keeps it live in CI and in any hook built
   on the CLI. To actually retire a type, move the file out of `{schema_dir}` entirely.
5. Subdirectories under `entities/` and `properties/` are for grouping only; they do not namespace anything.

### After changing a schema — verify in both directions

A schema edit that only ever passes is untested. Run all three:

```bash
# 1. the note that used to fail now passes
obsi-validate "<the note>" --check-links --vault-dir "$V" --schema-dir "$S"

# 2. something that SHOULD fail still fails (deliberately broken scratch file)
obsi-validate /tmp/known-bad.md --vault-dir "$V" --schema-dir "$S"; echo "exit=$?"   # expect 1

# 3. you didn't break the neighbours
obsi-validate "<vault>" -t <entity> --vault-dir "$V" --schema-dir "$S"
```

Step 2 is not optional. Without it you have confirmed that your rule is permissive,
not that it is correct.

## 4. Wiring it into an agent hook

The CLI is the right integration point for a PostToolUse / pre-commit hook: it takes
a single path, has no Obsidian dependency, and speaks JSON.

Contract worth honouring in any wrapper:

- **Fail loudly when the binary is missing.** A hook that silently skips validation
  because `obsi-validate` fell off `PATH` is worse than no hook — the guarantee
  disappears while the reassurance stays.
- **Resolve the binary, don't hardcode a path.** `bun link` puts it in the operator's
  `~/.bun/bin`, which differs per machine and per user.
- Decide explicitly what to do with warnings (see the unknown-type trap above).

## 5. Installing / after a `git pull`

```bash
npm install
npm run build:cli    # dist/ is gitignored — a fresh clone has NO binary
bun link
```

`dist/` is not in git and `bun link` symlinks the global command **into this working
directory**. Consequences to keep in mind:

- A fresh clone has no working `obsi-validate` until `build:cli` runs.
- After pulling new commits the global command still runs the **old** build until you
  rebuild. Nothing warns you.
- To check what the installed binary actually contains, grep `dist/cli.js` for a
  symbol introduced by the commit in question — mtimes lie, symbols don't.
