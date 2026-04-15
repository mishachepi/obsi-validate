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
| 0 | All files valid |
| 1 | At least one file has errors |

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
