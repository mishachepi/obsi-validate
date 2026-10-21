# CLAUDE.md

## Project Overview

**Property Validator** (`obsi-validate`) — Obsidian plugin, CLI and library that validate vault
frontmatter against a schema kept in the vault's own entity and property notes. The plugin and
the CLI share one validation core and must give the same verdicts.

## Build & Development

```bash
bun install                                   # dependencies
bun run dev                                   # plugin, watch mode
bun run build                                 # plugin: type-check + minified main.js
bun run build:cli                             # CLI and library: dist/cli.js, dist/index.js
bun run lint                                  # type-check only
bun test                                      # all tests
bun test tests/schema.test.ts                 # one file
bun src/cli.ts <vault> --check-links          # CLI from source
node scripts/check-plugin-bundle.mjs main.js  # plugin bundle requires only "obsidian" (CI)
```

`main.js` and `dist/` are build output (gitignored). A global `obsi-validate` made with
`bun link` and a vault plugin folder symlinked to `main.js` both run whatever was built last —
build in a separate clone when experimenting.

## Architecture

Validation order (`validate.ts`): YAML → type field → expected folder → normalize values
(`values.ts`: empty = not set, mdbase-style coercion) → shape engine (unknown fields, value
types, required/required_unless) → custom validators + link constraints → task intake → body
wikilinks and inline properties (`checkLinks`; warnings unless `strictLinks`). Messages come
from `values.ts`, so both engines word them the same.

Core, runtime-agnostic (takes `{path, content}`, no file system): `schema.ts`, `validate.ts`,
`rules/task-intake.ts`, `link-index.ts` (link parsing, index, Obsidian-style resolution),
`vault-files.ts` (which files are validated / linked / schema), `frontmatter.ts`, `values.ts`,
`mdbase/translate.ts`, `mdbase/adapter.ts`, `index.ts` (library entry).

Front ends: `cli.ts` + `config.ts` + `walk.ts` (CLI); `plugin-main.ts` + `bridge.ts` (vault
access, link-index cache, schema writes via `processFrontMatter`) + `plugin-settings.ts`,
`SettingsTab.ts`, `ui/`, `ResultsView.ts`, `VaultResultsView.ts` (plugin).

Rules that must hold:
- Any rule about which files count, how links resolve or how a value is read lives once in the
  core and is used by both front ends.
- The two shape engines (Zod, mdbase) agree: `tests/mdbase/parity.test.ts`.
- The plugin and the CLI agree on the same vault: `tests/plugin/bridge.test.ts`.

Docs: [architecture](docs/architecture.md), [schema reference](docs/schema-reference.md),
[CLI](docs/cli.md), [mdbase engine](docs/mdbase.md).

## Tech Stack

TypeScript, Bun (runtime, tests, CLI build), esbuild (plugin build), Zod, gray-matter,
@callumalpass/mdbase (CLI only), commander (CLI only).

## Project Structure

Follows the [Obsidian plugin layout](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin):
`manifest.json`, `styles.css`, `esbuild.config.mjs` at the root; all source in `src/`
(`src/plugin-main.ts` is the plugin entry); tests in `tests/` with a shared fixture vault in
`tests/fixtures/mini-vault/`.
