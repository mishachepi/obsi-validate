# CLI Usage

## Running

```bash
# Dev mode
bun run src/cli.ts --vault-dir /path/to/vault

# Installed globally
obsi-validate --vault-dir /path/to/vault
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `[path]` | File or directory to validate | — |
| `--schema-dir <path>` | Path to entity/property schema files | `./vault` or `$SCHEMA_DIR` |
| `--vault-dir <path>` | Vault root to validate | `.` or `$VAULT_DIR` |
| `-f, --format` | Output: `pretty` or `json` | `pretty` |
| `-t, --type` | Filter by entity type | — |

## Examples

```bash
# Validate specific directory
obsi-validate /path/to/vault/tasks

# Filter by entity type
obsi-validate --vault-dir /path/to/vault -t task

# JSON output (for piping)
obsi-validate --vault-dir /path/to/vault -f json

# Custom schema location
obsi-validate --schema-dir /other/vault --vault-dir /path/to/vault
```

## Environment variables

| Variable | Maps to |
|----------|---------|
| `SCHEMA_DIR` | `--schema-dir` |
| `VAULT_DIR` | `--vault-dir` |

## Library usage

Core modules are runtime-agnostic — pass `{ path, content }[]`, no fs dependency:

```typescript
import { loadSchema, validateFile, validateFiles } from "obsi-validate"

// Load schema from any source
const schema = loadSchema(entityFiles, propertyFiles)

// Validate single file
const result = validateFile({ path: "task.md", content: "---\ntype_key: task\n---" }, schema)

// Validate batch
const summary = validateFiles(files, schema)
```

This enables reuse in Obsidian plugin (via Vault API) or any other integration.
