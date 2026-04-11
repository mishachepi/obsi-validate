# CLAUDE.md

## Project Overview

**Property Validator** — Obsidian plugin + CLI that validates vault frontmatter against schemas defined in the vault's own entity/property files. Entity-centric architecture with inheritance support.

## Build & Development

```bash
npm install                          # install dependencies
npm run dev                          # build plugin with watch mode
npm run build                        # production build (type-check + minified)
bun test                             # run all tests
bun test tests/schema.test.ts        # run single test file
bun run src/cli.ts --vault-dir <path> # run CLI in dev
npm run build:cli                    # build CLI dist/ (cli.js + index.js)
```

## Architecture

Entity-centric, three-level validation with inheritance:

1. **schema.ts** — parses entity/property YAML, builds Zod validators, resolves entity inheritance, constructs `entityMap`
2. **validate.ts** — Level 1: fields vs entity schema. Level 2: values via Zod. Level 3: link constraints + custom validators + required fields.
3. **plugin-main.ts** — Obsidian plugin class, commands, reactive validation, status bar
4. **bridge.ts** — TFile ↔ RawFile adapter, vault index for link validation, file writes
5. **cli.ts** — CLI entry point (commander, file I/O, output formatting)

Core modules (`types.ts`, `schema.ts`, `validate.ts`) are runtime-agnostic — accept `{path, content}[]`, no file reads.

See [docs/architecture.md](docs/architecture.md) for diagrams and data flow.
See [docs/schema-reference.md](docs/schema-reference.md) for entity/property file format.
See [docs/getting-started.md](docs/getting-started.md) for plugin usage.

## Tech Stack

Bun (test runner), esbuild (bundler), TypeScript, Zod, gray-matter, commander (CLI only)

## Project Structure

Follows [official Obsidian plugin layout](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin):
- `manifest.json`, `styles.css`, `esbuild.config.mjs` at root
- `src/plugin-main.ts` — plugin entry point
- `src/` — all source (core library + plugin)
- `main.js` — built output (not committed, in .gitignore)
