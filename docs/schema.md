# Schema Reference

## Entity files

Location: `vault/entities/**/*.md`

Entity files declare structure — which fields belong to this type.

```yaml
---
component_type: entity
name: task
properties:
  status: { required: true }
  priority: {}
  estimate: {}
allow_extra: false          # if true, unknown fields don't produce warnings
---
```

- `component_type: entity` — required, identifies as entity file
- `name` — entity name (fallback: filename minus `_entity.md`)
- `properties` — field declarations with optional `{ required: true }`
- `allow_extra` — suppress unknown field warnings (default: false)

## Property files

Location: `vault/properties/*.md`

Property files declare validation — how to check field values. Properties don't know which entities use them.

```yaml
---
property_type: enum
name: status
allowed_values: [Backlog, Planned, In Progress, Done]
---
```

- `property_type` — required, determines Zod validator
- `name` — property name (fallback: filename minus `.md`)
- Constraints depend on type (see below)

## Supported types

| Type | Validates as | Constraints |
|------|-------------|-------------|
| `string` | String | — |
| `number` | Number | `min_value`, `max_value` |
| `boolean` | Boolean | — |
| `date` | String or Date | — |
| `time` | String | — |
| `datetime` | String or Date | — |
| `enum` | One of allowed values | `allowed_values` (required) |
| `link` | String or string[] | — |
| `list` | Array | — |
| `emoji` | String | — |

## Vault files

Validated files must have `type_key` in frontmatter to be matched against an entity:

```yaml
---
type_key: task
status: In Progress
estimate: 4
---
```

Files without `type_key` are skipped.
