# Schema Reference

## Directory Structure

```
{schema_dir}/
  entities/
    task_entity.md
    structure/
      area_entity.md
      epic_entity.md
    cmdb/
      book_entity.md
    _deprecated/          # archived entities (not loaded)
  properties/
    status_property.md
    priority_property.md
    _deprecated/          # archived properties (not loaded)
```

Subdirectories are used for grouping in the UI. `_deprecated/` directories are excluded from schema loading.

## Entity Files

Location: `{schema_dir}/entities/**/*_entity.md`

Entity files declare structure -- which fields belong to this type and whether they are required.

```yaml
---
component_type: entity
extends: trackable
properties:
  priority: { required: true }
  estimate: {}
  dod: {}
allow_extra: false
---
```

| Field | Required | Description |
|-------|----------|-------------|
| `component_type` | yes | Must be `entity` |
| `name` | no | Entity name. Fallback: filename minus `_entity.md` |
| `extends` | no | Parent entity name for inheritance |
| `properties` | no | **Own** field declarations with optional `{ required: true }` |
| `allow_extra` | no | If `true`, unknown fields don't produce warnings (default: `false`) |

### Entity Inheritance

Entities can inherit properties from a parent via `extends`:

```
base_entity        → type_key (implicit)
trackable_entity   → extends: base,       properties: {status, created, updated}
structure_entity   → extends: trackable,  properties: {area, description}
task_entity        → extends: structure,   properties: {priority, estimate, dod}
```

`task` gets all 8 properties: 3 own + 2 from structure + 3 from trackable. Child's config overrides parent's (e.g., child can make an inherited property required).

Entities without `extends` work as before — all properties are own. Migration is gradual: add `extends` and remove inherited properties from the `properties` block.

## Property Files

Location: `{schema_dir}/properties/**/*_property.md`

Property files declare validation -- how to check field values. Properties don't know which entities use them.

```yaml
---
property_type: enum
allowed_values:
  - Backlog
  - In Progress
  - Done
---
```

| Field | Required | Description |
|-------|----------|-------------|
| `property_type` | yes | Determines Zod validator (see types below) |
| `name` | no | Property name. Fallback: filename minus `_property.md` |
| `allowed_values` | enum only | List of allowed values |
| `min_value` | number only | Minimum numeric value |
| `max_value` | number only | Maximum numeric value |
| `unit` | number only | Unit label (informational) |
| `target_type_key` | link/list | Target note must have this entity type |
| `target_folder` | link/list | Target note must be in this folder (prefix match) |
| `target_has_property` | link/list | Target note must have this property |
| `target_property_value` | link/list | `{property, value}` -- target's property must equal value |
| `custom_validator` | any | JS expression for post-validation (see below) |

## Supported Types

| Type | Validates as | Extra constraints |
|------|-------------|-------------------|
| `string` | String | custom_validator |
| `number` | Number | `min_value`, `max_value`, `unit` |
| `boolean` | Boolean | |
| `date` | String or Date | |
| `time` | String | |
| `datetime` | String or Date | |
| `enum` | One of allowed_values | `allowed_values` (required for validation) |
| `link` | String or string[] | link constraints |
| `wikilink` | String or string[] | link constraints (alias for link) |
| `list` | Array | link constraints (applied to each item) |
| `emoji` | String | |

## Link Constraints

For `link`, `wikilink`, and `list` types, you can constrain what the linked notes must satisfy:

```yaml
---
property_type: link
target_type_key: area
target_folder: Areas/
---
```

This validates that every link in the field points to a note with `type_key: area` that lives in `Areas/` folder.

```yaml
---
property_type: list
target_has_property: status
target_property_value:
  property: status
  value: Active
---
```

This validates that every item in the list links to a note that has a `status` property with value `Active`.

Link resolution: `[[Path/Name|Alias]]` -> `Path/Name` -> lookup in vault index by basename and full path.

## Custom Validators

Any property can have a `custom_validator` -- a JS expression that receives the `value` variable and returns:
- `true` -- validation passes
- `false` -- validation fails (generic error)
- a string -- validation fails with that string as error message

```yaml
---
property_type: string
custom_validator: "typeof value === 'string' && value.length <= 100"
---
```

```yaml
---
property_type: number
min_value: 0
custom_validator: "value % 0.5 === 0 ? true : 'Must be a multiple of 0.5'"
---
```

Custom validators run after Zod type validation. If the expression throws, a warning is emitted (not an error).

**Security note:** Custom validators execute as JavaScript in the same trust context as the vault. Only use validators from sources you trust.

## Validated Notes

Notes must have the configured type key field (default: `type_key`) in frontmatter to be matched against an entity:

```yaml
---
type_key: task
status: In Progress
estimate: 4
area: "[[Work]]"
---
```

Notes without the type key field are skipped (warning emitted). Notes with an unknown entity type produce a warning.
