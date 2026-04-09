# Property Validator

Obsidian plugin that validates vault frontmatter against schemas defined in the vault itself. No external config — schema lives as YAML frontmatter in entity/property files.

## Features

- Entity-centric schema: entities declare fields, properties define validation rules
- Entity inheritance via `extends` (with circular dependency detection)
- Three-level validation: structure, Zod types, link constraints + custom JS
- Reactive status bar with per-file validation
- Settings UI with 3 tabs: Settings, Entities, Properties
- Entity/Property CRUD with auto-save
- Link constraints: validate what linked notes must satisfy
- Folder-based grouping

## Install

```bash
git clone <repo-url> && cd property-validator
npm install && npm run build
```

Copy `main.js`, `manifest.json`, `styles.css` to `.obsidian/plugins/property-validator/` in your vault.

## CLI

Also works as a standalone CLI:

```bash
npm run build:cli && bun link
obsi-validate --vault-dir /path/to/vault
```

## Docs

- [Plugin usage](docs/plugin.md) — installation, settings, commands, schema management
- [Schema reference](docs/schema.md) — entity/property file format, types, inheritance, link constraints
- [CLI usage](docs/usage.md) — options, config, env vars, library API
- [Architecture](docs/architecture.md) — data flow, modules, design decisions
- [Security](docs/security.md) — trust model, custom validators, dependencies

## TODO

- [ ] Improve entity inheritance (inherit allow_extra, multi-level UI display, abstract entities)
- [ ] Inline decorations: red underline on invalid frontmatter values, hover tooltips
- [ ] Quick-fix suggestions for enum values (fuzzy match "Did you mean...?")
- [ ] Autofix suggestions: `"true"` to `true`, array to string, string to array, type coercion

## Tech Stack

TypeScript, esbuild, Zod, gray-matter, Obsidian API
