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

Body wikilinks are **not** checked unless you pass `--check-links`. A run without it
says nothing about broken links.

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

!!! warning "Exit code alone is not a verdict"
    An **unknown entity type is a warning, not an error**: the file is reported as
    `Valid`, `invalid` stays `0`, and the command exits `0`.

    ```
    ---
    entity: totally_made_up_xyz
    ---
    →  ⚠ entity: Unknown entity type: totally_made_up_xyz
       Total: 1 | Valid: 1 | Invalid: 0    exit 0
    ```

    A typo in the type name therefore *passes*, because nothing knows what to check
    the note against. The same applies to `Skipped` files — they were never
    validated at all.

    In CI or in a hook that must block on this, parse `-f json` and fail on
    warnings where the message matches `Unknown entity type`.

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
