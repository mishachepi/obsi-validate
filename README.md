# Property Validator

Validates Obsidian frontmatter against a schema kept in the vault itself: **entity** notes say
which fields a note type has, **property** notes say what a valid value is. Works as an Obsidian
plugin (live, while you edit), as a CLI (git hooks, CI) and as a library — with the same rules
and the same verdicts.

## Features

- Entity inheritance via `extends`
- Value types, allowed values, ranges, required and conditionally required (`required_unless`) fields, custom JavaScript checks
- Link checks: linked notes must exist and can be required to have a type, folder or property; body wikilinks resolved the way Obsidian resolves them
- Live status bar and result panels in Obsidian
- Schema editor in Settings (Entities, Properties) that keeps everything it does not edit
- CLI with JSON output for hooks and CI; two interchangeable shape engines — Zod and [mdbase](https://mdbase.dev/) JSON Schema — and `mdbase-export` to write the schema as an mdbase collection

## Install

Requires [Bun](https://bun.sh) 1.3+ (and Node.js 20+ for the plugin build).

```bash
git clone https://github.com/mishachepi/obsi-validate.git && cd obsi-validate
bun install && bun run build
```

Copy `main.js`, `manifest.json`, `styles.css` to `.obsidian/plugins/property-validator/` in your
vault and enable **Property Validator**.

CLI:

```bash
bun run build:cli && bun link
obsi-validate /path/to/vault --check-links
```

## Docs

- [About](docs/index.md) — overview and features
- [Getting started](docs/getting-started.md) — installation, updating, first schema
- [Configuration](docs/configuration.md) — plugin settings and the schema editor
- [Schema reference](docs/schema-reference.md) — file format, types, validation rules
- [CLI](docs/cli.md) — options, config file, output, library
- [Architecture](docs/architecture.md) — modules, data flow, security
- [mdbase engine](docs/mdbase.md) — the JSON-Schema engine and `mdbase-export`
- [Troubleshooting](docs/troubleshooting.md) — common problems

## Development

```bash
bun test            # all tests
bun run lint        # type-check
bun run build       # plugin → main.js
bun run build:cli   # CLI and library → dist/
```

## Ideas

- [ ] Inherit `allow_extra`; abstract entities
- [ ] Inline decorations: underline invalid frontmatter values, hover tooltips
- [ ] Quick fixes for enum values ("Did you mean…?")
- [ ] Autofix: `"true"` → `true`, list ↔ single value

## Tech Stack

TypeScript, Bun, esbuild, Zod, @callumalpass/mdbase (CLI), gray-matter, commander (CLI), Obsidian API
