# CLI

`obsi-validate` runs the same validation as the plugin outside Obsidian: in git hooks, CI and
scripts.

## Installation

Requires [Bun](https://bun.sh) 1.3 or later.

```bash
bun install
bun run build:cli    # builds dist/cli.js
bun link             # puts obsi-validate on your PATH (~/.bun/bin)
```

`obsi-validate` runs `dist/cli.js` from the repository, so after pulling changes run
`bun install && bun run build:cli` again.

## Usage

```bash
# Validate a vault
obsi-validate /path/to/vault

# Validate one note or one folder — the vault root is found automatically
obsi-validate /path/to/vault/tasks/my-task.md --check-links

# Only report notes of one type
obsi-validate /path/to/vault -t task

# JSON output
obsi-validate /path/to/vault -f json

# Compile the schema to an mdbase collection (mdbase.yaml + _types/*.md)
obsi-validate mdbase-export --schema-dir /path/to/vault/_system --out ./mdbase
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `[path]` | File or folder to validate | the vault |
| `--vault-dir <path>` | Vault root: the link index, folder rules and printed paths are based on it | the nearest folder above `[path]` that has `_system/entities`, else config `vault_dir` |
| `--schema-dir <path>` | Folder with `entities/` and `properties/` | `<vault>/_system`, or config `schema_dir` |
| `-f, --format <type>` | `pretty` or `json` (any other value prints pretty) | `pretty` |
| `-t, --type <entity>` | Only report and count notes of this type | all |
| `--type-key-field <name>` | Frontmatter field naming a note's type | config `type_key_field`, else `type_key` if the schema declares it, else `entity` |
| `--check-links` | Build the link index and check link constraints (`target_*`), body wikilinks and inline properties | off |
| `--strict-links` | With `--check-links`: body wikilinks and inline properties that fail are errors, not warnings | off |
| `--engine <name>` | Shape engine: `mdbase` or `zod` (see [mdbase engine](mdbase.md)) | `mdbase` |
| `--exclude <dir>` | Folder name to skip, at any depth, in validation and in the link index; repeatable; added to config `exclude_dirs` | — |

Without `--check-links` neither link constraints nor body links are checked, so such a run
says nothing about links. Link constraints in frontmatter are errors; body wikilinks and inline
properties are warnings, because a link to a note you have not written yet is normal in
Obsidian. Use `--strict-links` where they must not exist, e.g. in a hook that checks notes
written by scripts.

Skipped in folder walks: dot-folders, `_archive/`, `_skill/`, `_index.md` files and the
template folders set in `.obsidian` (core Templates and Templater). A file passed as `[path]`
is always validated. Archived notes still count as link targets, by full path.

## Configuration

Settings come from, in order: command-line options, environment variables (`VAULT_DIR`,
`SCHEMA_DIR`; empty counts as unset), the vault found above an explicitly given path, the config
file, and finally the vault found above the current folder.

The config file is `$XDG_CONFIG_HOME/obsi-validate/config.json`, or
`~/.config/obsi-validate/config.json`:

```json
{
  "vault_dir": "/path/to/vault",
  "schema_dir": "/path/to/vault/_system",
  "type_key_field": "type_key",
  "default_type": "",
  "exclude_dirs": ["_templates"]
}
```

| Key | Description |
|-----|-------------|
| `vault_dir`, `schema_dir` | Used when no path is given, or when no vault is found above it. |
| `type_key_field` | The type field (see `--type-key-field`). |
| `default_type` | Type for notes without a type field; empty skips them. Config file only. |
| `exclude_dirs` | Folder names to skip, like `--exclude`. |

## `mdbase-export`

```bash
obsi-validate mdbase-export [--schema-dir <path>] [--out <dir>] [--type-key-field <name>]
```

Writes an [mdbase](https://mdbase.dev/) collection: `mdbase.yaml` plus one `_types/<entity>.md`
per entity, holding the entity's resolved properties as JSON Schema 2020-12. Output is the same
on every run. The schema notes stay the source; never edit the generated files. Without `--out`
a new temp folder is used and its path printed. See [mdbase engine](mdbase.md).

## Output

### Pretty (default)

Only notes with errors (`FAIL`) or warnings (`WARN`) are listed, by vault path:

```
FAIL tasks/bad-enum.md [task]
  ✗ status: "Doing" is not an allowed value. Allowed: Backlog, In Progress, Done, Closed, Rejected

WARN tasks/broken-body-link.md [task]
  ⚠ body: [[No Such Note]] not found in vault

WARN tasks/unknown-field.md [task]
  ⚠ colour: Not a property of task

Total: 41 | Valid: 10 | Invalid: 11 | Skipped: 20
```

Both engines give the same messages. Problems outside a frontmatter property are labelled by
where they are: `frontmatter` (YAML), `folder` (`expected_folder`), `body` (a wikilink) and
`<key> (inline)`.

### JSON

```json
{
  "total": 41,
  "valid": 14,
  "invalid": 7,
  "skipped": 20,
  "results": [
    {
      "file": "/path/to/vault/tasks/bad-enum.md",
      "entityType": "task",
      "valid": false,
      "errors": [{ "field": "status", "message": "…", "expected": "enum", "received": "Doing" }],
      "warnings": []
    }
  ]
}
```

`results` holds only notes with errors or warnings; `file` is an absolute path. Findings in the
body use the fields `__body_link__` and `__inline__<key>`; an `expected_folder` error uses
`__path__`; unparsable YAML uses `_yaml`.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | No note has errors (warnings and skipped notes still exit 0) |
| 1 | At least one note has errors, or the run failed (schema could not load, path missing, unknown `--engine`) |

!!! note "Skipped is not validated"
    An unknown type is an error. A note with no type field at all is `Skipped`: it was not
    validated, and it does not fail the run. Set `default_type` in the config to give such
    notes a type. With `--strict-links`, a skipped note whose body has a broken link counts as
    invalid.

## Library

The validation core can be used from code running on Bun (after `bun run build:cli`, the
package entry is `dist/index.js`). It takes file contents, not paths:

```typescript
import { loadSchema, validateFile, buildIndexFromEntries, resolveTypeKeyField } from "obsi-validate";

const schema = loadSchema(entityFiles, propertyFiles); // [{ path, content }]
const typeKeyField = resolveTypeKeyField(schema);      // "type_key" or "entity"
const vaultIndex = buildIndexFromEntries(notes);       // [{ path, data }], for link checks

const result = validateFile(
  { path: "tasks/task.md", content: "---\ntype_key: task\nstatus: Done\n---" },
  schema,
  { typeKeyField, vaultIndex, checkLinks: true },
);
```

Also exported: `validateFiles`, `parseEntities`, `parseProperties`, `detectTypeKeyField`,
`resolveLink`, `parseWikilinkTarget`, `zodShapeEngine`, `mdbaseShapeEngine` (pass as
`shapeEngine`; the default is Zod) and the types.
