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
| Entity field | `entity` | Frontmatter field name that identifies entity type |
| Default entity type | (none) | Entity type used when the entity field is missing. Empty = skip file |
| Show ribbon icon | off | Show "Validate vault" button in left sidebar |

## Commands

| Command | Description |
|---------|-------------|
| **Validate current file** | Check the active note (requires open file) |
| **Validate vault** | Scan all markdown files in the vault |
| **Show validation results** | Open the per-file results panel |

Available via Command Palette (Cmd/Ctrl+P) or ribbon icon.

## Results Panels

### Validation Results (per-file)

Opens in the right sidebar. Auto-updates on file change. Shows:

- Entity type badge (clickable — opens entity settings)
- Error/warning list with clickable field names (opens property settings)
- Refresh button (↻)
- Status bar shows `[entity_type] valid` or `[entity_type] N error(s)`

### Vault Validation (full scan)

Separate panel opened by "Validate vault" command. Not overwritten by per-file validation. Shows:

- **Summary**: Total / Valid / Invalid / Skipped counts
- **File list**: Only files with issues
  - `FAIL` (red) = has errors
  - `WARN` (yellow) = warnings only
- **Click file path** to navigate to the note
- Refresh button (↻) to re-scan

## Managing Schemas

### Entities Tab

Settings -> Property Validator -> **Entities** tab

- Lists all entities grouped by subdirectory (folder shown as tag)
- Expand to see: properties (with required toggles), extends dropdown, allow_extra toggle
- Add/remove properties from an entity
- Inherited properties shown read-only, grouped by source entity
- Create new entities
- **Open file** button — opens the entity's `.md` declaration
- Archive entities (moves to `_deprecated/` directory)

### Properties Tab

Settings -> Property Validator -> **Properties** tab

- Lists all properties grouped by subdirectory (folder shown as tag)
- Expand to see: type, constraints (type-specific), custom validator
- **Nullable** toggle — allow null/empty values for any property
- **Enum properties**: edit allowed values list
- **Number properties**: set min/max and unit
- **Link/List properties**: configure link constraints:
  - Target entity type (comma-separated for multiple)
  - Target folder (prefix match)
  - Target has property (field must exist)
  - Target property value (field must equal value)
- **Custom validator**: JS expression for any type
- Create new properties
- **Open file** button — opens the property's `.md` declaration
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
