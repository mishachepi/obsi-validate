# mdbase engine

[mdbase](https://mdbase.dev/) is an open specification for typed markdown collections: each
type is a JSON Schema 2020-12 document, and a collection is configured by `mdbase.yaml`.
obsi-validate uses it in two ways:

- **As the CLI's shape engine** (`--engine mdbase`, the default): the vault schema is compiled
  in memory into one JSON Schema per entity and checked with mdbase's validator.
- **As an export format**: `obsi-validate mdbase-export` writes the same compiled schema to
  disk, for editors, language servers or any other mdbase tool.

Your entity and property notes stay the only place the schema is written; the JSON Schema is
always generated from them. The package is `@callumalpass/mdbase`, pinned to an exact
pre-release version (`0.3.0-rc.9`) because the 0.3 line is not stable yet.

---

## What the engine checks

The engine covers the **shape** step of validation: unknown fields, value types, `required`
and `required_unless`. Every other step — YAML, type field, expected folder, custom validators,
link constraints, task intake, body links — is shared code that runs the same way whichever
engine is used. The plugin uses the Zod engine; `--engine zod` selects it in the CLI.

The two engines give the same verdicts. `tests/mdbase/parity.test.ts` runs every behaviour
class through both and fails on any difference. Messages differ in wording:

| Problem | mdbase | Zod |
|---------|--------|-----|
| value not in `allowed_values` | `Invalid enum value at "status" for type "task"` | `Invalid enum value. Expected 'Backlog' \| …, received 'Doing'` |
| number above `max_value` | `Number at "estimate" is too large for type "task"` | `Number must be less than or equal to 360` |

---

## How the schema is compiled

Each entity becomes one type: its own and inherited properties, `type_key` fixed to the entity
name, and:

| Schema | JSON Schema |
|--------|-------------|
| `required: true` | listed in `required` |
| `required_unless` | `allOf: [{ if: <condition>, then: {}, else: { required: [field] } }]` |
| `allow_extra` | `additionalProperties` |
| `property_patterns` | `patternProperties` |
| `target_type_key` | `collection.links.<field>: { target_type, validate_exists: true }` |

| `property_type` | JSON Schema |
|-----------------|-------------|
| `string`, `time`, `date`, `datetime`, `link` | `{ type: string }` (dates from YAML are passed as ISO text) |
| `number` | `{ type: number }` with `minimum` / `maximum` |
| `boolean` | `{ type: boolean }` |
| `enum` | `{ enum: [...] }`, numbers in both spellings (`1` and `"1"`) |
| `links` | `{ type: [string, array], items: { type: string } }` |
| `list` | `{ type: [array, string, number, boolean] }` |
| `emoji` | `{ type: string, pattern: <emoji only> }` |
| `any` and unknown types | `{}` (anything) |
| `nullable: true` | adds `null` to the type |

Not expressible in mdbase and therefore handled outside the engine: `target_folder`,
`target_has_property`, `target_property_value`, `custom_validator`, `expected_folder`, the
task-intake rule and body links.

---

## `mdbase-export`

```bash
obsi-validate mdbase-export --schema-dir /path/to/vault/_system --out ./mdbase
```

```
mdbase/
  mdbase.yaml          # spec_version 0.3.0, types_folder _types, explicit_type_keys [type_key]
  _types/
    task.md            # frontmatter = the type definition; body = "generated, do not edit"
    epic.md
    …
```

Output is identical on every run. Without `--out`, a new temp folder is used and printed. The
type field is detected the same way as for validation (`--type-key-field` to override).

---

## In the plugin

The plugin runs Zod. mdbase's validator module needs only `ajv` and the engine bundles for the
browser (about 200 KB with js-yaml, which the plugin already ships), so the plugin could run
the same engine as the CLI. The CLI imports that module directly
(`src/mdbase/json-schema.ts`) because the package exposes only its full entry point, which
loads the whole library; a test checks the import is the same function the package exports.
