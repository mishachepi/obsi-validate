# CLI

Property Validator includes a standalone CLI tool that runs the same validation engine outside of Obsidian. Useful for CI pipelines, batch processing, or scripting.

## Installation

```bash
npm install
npm run build:cli    # builds to dist/cli.js
bun link             # makes obsi-validate available globally
```

## Usage

```bash
# Validate a vault directory
obsi-validate --vault-dir /path/to/vault

# Validate a single file
obsi-validate /path/to/vault/my-task.md

# Filter by entity type
obsi-validate --vault-dir /path/to/vault -t task

# JSON output
obsi-validate --vault-dir /path/to/vault -f json

# Same run, shape-checked by mdbase (JSON Schema) instead of Zod
obsi-validate --vault-dir /path/to/vault --engine mdbase

# Compile the vault schema to an mdbase collection (mdbase.yaml + _types/*.md)
obsi-validate mdbase-export --schema-dir /path/to/vault/_system --out ./mdbase
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `[path]` | File or directory to validate | `--vault-dir` value |
| `--schema-dir <path>` | Path to schema files | from config |
| `--vault-dir <path>` | Vault root | from config |
| `-f, --format <type>` | Output: `pretty` or `json` | `pretty` |
| `-t, --type <entity>` | Filter results by entity type | all |
| `--check-links` | Also validate body wikilinks and inline properties | off |
| `--type-key-field <name>` | Frontmatter field identifying the entity type | auto-detected from schema, falls back to `entity` |
| `--engine <name>` | Shape engine: `zod` or `mdbase` (JSON Schema via `@callumalpass/mdbase`). Bespoke rules (link constraints, expected folder, task intake, body links) run identically on both | `zod` |

Body wikilinks are **not** checked unless you pass `--check-links`. A run without it
says nothing about broken links.

## `mdbase-export`

```bash
obsi-validate mdbase-export [--schema-dir <path>] [--out <dir>] [--type-key-field <name>]
```

Compiles the entity/property notes into an [mdbase](https://mdbase.dev/) collection:
`mdbase.yaml` plus one `_types/<entity>.md` per entity, each carrying the entity's resolved
properties as JSON Schema 2020-12. Output is deterministic and idempotent; the notes stay the
source of truth and the generated files are never edited by hand. Without `--out` a fresh temp
directory is used and its path printed. Background and verdict: [mdbase-spike.md](mdbase-spike.md).

## Config file

`~/.config/obsi-validate/config.json`:

```json
{
  "schema_dir": "/path/to/vault/System",
  "vault_dir": "/path/to/vault",
  "type_key_field": "entity",
  "default_type": ""
}
```

Resolution priority: **CLI flags > config file > defaults**. `schema_dir` and `vault_dir` also accept environment variables (`SCHEMA_DIR`, `VAULT_DIR`).

## Output

### Pretty format (default)

```
FAIL path/to/note.md [task]
  ✗ status: Expected 'Backlog' | 'In Progress' | 'Done', received 'Urgent'
  ⚠ foo: Unknown property for this entity

Total: 10 | Valid: 7 | Invalid: 2 | Skipped: 1
```

### JSON format

```json
{
  "total": 10,
  "valid": 7,
  "invalid": 2,
  "skipped": 1,
  "results": [...]
}
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | No file has errors — **warnings and skipped files still exit 0** |
| 1 | At least one file has errors |

!!! note "Skipped is not validated"
    An **unknown entity type is an error** (`✗ entity: Unknown entity type: …`, exit `1`).
    A file with **no** type field at all is `Skipped`: it was never validated, and it
    still exits `0`. Use `default_type` in the config to give such files a type.

## Library API

The core validation modules are runtime-agnostic and can be used as a library:

```typescript
import { loadSchema, validateFile, validateFiles } from "obsi-validate";

const schema = loadSchema(entityFiles, propertyFiles);
const result = validateFile(
  { path: "task.md", content: "---\nentity: task\nstatus: Done\n---" },
  schema,
  { typeKeyField: "entity" }
);
```

Input is `{ path: string, content: string }[]` — no file system dependency.
