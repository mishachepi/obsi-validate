# CLAUDE.md

## Project Overview

TypeScript CLI + library (`obsi-validate`) that validates Obsidian vault frontmatter against schemas defined in the vault's own entity/property files. Designed for dual use: standalone CLI and Obsidian plugin module.

## Build & Development

```bash
bun install                          # install dependencies
bun test                             # run all tests
bun test tests/schema.test.ts        # run single test file
bun run src/cli.ts --vault-dir <path> # run CLI in dev
bun run build                        # build dist/ (cli.js + index.js)
```

## Architecture

Entity-centric, two-level validation: **schema.ts -> validate.ts -> cli.ts**

1. **schema.ts** — parses entity/property YAML frontmatter, builds Zod validators, constructs `entityMap`
2. **validate.ts** — Level 1: fields vs entity schema. Level 2: values via Zod. Level 3: required fields.
3. **cli.ts** — file I/O (only module with fs access), commander CLI, output formatting
4. **index.ts** — library entry point, re-exports core API

Core modules (`types.ts`, `schema.ts`, `validate.ts`) are runtime-agnostic — accept `{path, content}[]`, no file reads. This enables reuse in Obsidian plugin.

See [docs/architecture.md](docs/architecture.md) for diagrams and data flow.
See [docs/schema.md](docs/schema.md) for entity/property file format.

## Vault Location

Schema source: `/Volumes/mch/`, symlinked via `vault/entities/` and `vault/properties/`.

## Tech Stack

Bun (runtime, test runner), Zod, gray-matter, commander

## Phase 1 Scope (current)

Implemented: schema loader, validator, CLI, library entry point.

Do NOT implement yet:
- Entity inheritance (Phase 3)
- Obsidian plugin wrapper (Phase 2)
- Cross-entity validation (Phase 3)
