# Obsidian Plugin

## Installation

1. Build the plugin:
   ```bash
   npm install && npm run build
   ```

2. Copy or symlink to your vault:
   ```bash
   mkdir -p /path/to/vault/.obsidian/plugins/property-validator
   cp main.js manifest.json styles.css \
      /path/to/vault/.obsidian/plugins/property-validator/
   ```

   Or use symlinks for development:
   ```bash
   ln -sf $(pwd)/main.js /path/to/vault/.obsidian/plugins/property-validator/main.js
   ln -sf $(pwd)/manifest.json /path/to/vault/.obsidian/plugins/property-validator/manifest.json
   ln -sf $(pwd)/styles.css /path/to/vault/.obsidian/plugins/property-validator/styles.css
   ```

3. In Obsidian: Settings -> Community plugins -> Enable "Property Validator"

## Configuration

Settings -> Property Validator -> **Settings** tab:

| Setting | Default | Description |
|---------|---------|-------------|
| Schema directory | `.` | Folder with `entities/` and `properties/` subdirs (relative to vault root) |
| Show ribbon icon | off | Show "Validate vault" button in left sidebar |
| Type key field | `type_key` | Frontmatter field that identifies entity type |

## Commands

| Command | Description |
|---------|-------------|
| **Validate current file** | Check the active note (requires open file) |
| **Validate vault** | Scan all markdown files in the vault |

Available via Command Palette (Cmd/Ctrl+P) or ribbon icon.

## Results Panel

Opens in the right sidebar. Shows:

- **Summary**: Total / Valid / Invalid / Skipped counts
- **File list**: Only files with issues, sorted by severity
  - `FAIL` (red) = has errors (invalid values, missing required fields)
  - `WARN` (yellow) = has warnings only (unknown fields, missing type key)
- **Click file path** to navigate to the note
- **Status bar** shows error count (click to open results panel)

## Managing Schemas

### Entities Tab

Settings -> Property Validator -> **Entities** tab

- Lists all entities grouped by subdirectory (folder shown as tag)
- Expand to see: properties (with required toggles), allow_extra toggle
- Add/remove properties from an entity
- Create new entities
- Archive entities (moves to `_deprecated/` directory)

### Properties Tab

Settings -> Property Validator -> **Properties** tab

- Lists all properties grouped by subdirectory (folder shown as tag)
- Expand to see: type, constraints (type-specific), custom validator
- **Enum properties**: edit allowed values list
- **Number properties**: set min/max and unit
- **Link/List properties**: configure link constraints:
  - Target entity type (dropdown from known entities)
  - Target folder (prefix match)
  - Target has property (field must exist)
  - Target property value (field must equal value)
- **Custom validator**: JS expression for any type
- Create new properties
- Archive properties (moves to `_deprecated/`)

## Schema Caching

The plugin caches the parsed schema in memory. Cache is automatically invalidated when:
- Any file in `{schema_dir}/entities/` or `{schema_dir}/properties/` is created, modified, or deleted
- Schema directory setting is changed
- Entity/property is saved or archived via the UI

## Reactive Validation

The plugin automatically validates the active file:
- On file modify (debounced 800ms)
- On active file change
- Status bar shows `[entity_type] valid` or `[entity_type] N error(s)`
- Click status bar to open results panel
- Results panel auto-updates when the file changes

## Development

```bash
npm install
npm run dev        # build with watch mode (auto-rebuild on changes)
npm run build      # production build (type-check + minified)
```

After rebuilding, reload Obsidian with Ctrl+R (or Cmd+R on Mac) to pick up changes.
