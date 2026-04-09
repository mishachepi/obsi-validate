# CLI Usage

## Installation

```bash
cd /path/to/property-validator
bun install
bun run build
bun link           # makes `property-validator` available globally
```

## Running

```bash
# Validate a directory
property-validator --vault-dir /path/to/vault

# Validate a single file
property-validator /path/to/vault/my-task.md

# Filter by entity type
property-validator --vault-dir /path/to/vault -t task

# JSON output
property-validator --vault-dir /path/to/vault -f json
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `[path]` | File or directory to validate | `--vault-dir` value |
| `--schema-dir <path>` | Path to entity/property schema files | from config |
| `--vault-dir <path>` | Vault root to validate | from config |
| `-f, --format` | Output: `pretty` or `json` | `pretty` |
| `-t, --type` | Filter by entity type | all |

## Config File

`~/.config/obsi-validate/config.json`:

```json
{
  "schema_dir": "/path/to/vault/System",
  "vault_dir": "/path/to/vault",
  "type_key_field": "type_key",
  "default_type": ""
}
```

Resolution priority: CLI flags > environment variables > config file > defaults.

## Environment Variables

| Variable | Maps to |
|----------|---------|
| `SCHEMA_DIR` | `--schema-dir` |
| `VAULT_DIR` | `--vault-dir` |

## Library Usage

Core modules are runtime-agnostic -- pass `{ path, content }[]`:

```typescript
import { loadSchema, validateFile, validateFiles } from "property-validator"
import type { RawFile, ValidateOptions } from "property-validator"

// Load schema
const schema = loadSchema(entityFiles, propertyFiles)

// Validate single file
const result = validateFile(
  { path: "task.md", content: "---\ntype_key: task\nstatus: Done\n---" },
  schema,
  { typeKeyField: "type_key" }
)

// Validate batch
const summary = validateFiles(files, schema)

// With link constraints (pass vault index)
const vaultIndex = new Map([
  ["Work", { path: "Areas/Work.md", data: { type_key: "area" } }],
])
const result2 = validateFile(file, schema, { vaultIndex })
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All files valid |
| 1 | At least one file has errors |
