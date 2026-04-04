# obsi-validate

Validates Obsidian vault frontmatter against schemas defined in the vault itself. No external config — schema lives as YAML frontmatter in entity/property files.

## Install

```bash
git clone <repo-url> && cd obsi-pydantic
bun install && bun run build && bun link
```

## Configure

```bash
mkdir -p ~/.config/obsi-validate
cat > ~/.config/obsi-validate/config.json << 'EOF'
{
  "schema_dir": "/path/to/vault/Notes/System",
  "vault_dir": "/path/to/vault"
}
EOF
```

`schema_dir` — directory containing `entities/` and `properties/` subdirectories.

## Usage

```bash
obsi-validate                    # validate entire vault
obsi-validate /path/to/tasks     # validate directory
obsi-validate /path/to/file.md   # validate single file
obsi-validate -t task            # filter by entity type
obsi-validate -f json            # JSON output
```

## How It Works

**Entity files** define structure (which fields, required/optional).
**Property files** define validation (type, constraints).
Vault files are matched by `type_key` in frontmatter.

```
Level 1: Does this entity allow this field?     → warning if not
Level 2: Is the value valid for this type?       → error if not
Level 3: Are all required fields present?        → error if not
```

```
FAIL tasks/broken.md [task]
  ✗ status: Invalid enum value
  ✗ estimate: Number must be <= 8

Total: 349 | Valid: 259 | Invalid: 74 | Skipped: 16
```

Exit code `1` if any files are invalid.

## Library

```typescript
import { loadSchema, validateFile } from "obsi-validate"
```

Core modules are runtime-agnostic — accept `{path, content}[]`. Reusable in Obsidian plugin.

## Docs

- [Schema reference](docs/schema.md) — entity/property file format, supported types
- [CLI usage](docs/usage.md) — options, config, env vars, examples
- [Architecture](docs/architecture.md) — data flow, modules, design decisions

## Tech Stack

Bun, Zod, gray-matter, commander
