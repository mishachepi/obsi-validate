# Troubleshooting

## A note is not validated

- **No status-bar dot.** The note has no type field, so it is skipped. Check that
  **Entity field** in the settings matches the field your notes use (`entity` by default,
  `type_key` in many vaults), or set **Default entity type**.
- **The note is under `_archive/`, `_skill/` or a dot-folder, or is named `_index.md`.**
  These are never validated, by the plugin or the CLI.

## "Unknown entity type"

The type value has no matching entity file. Check the spelling, and that the entity file is
in `entities/` and not in `entities/_deprecated/` — retired schema files are ignored.

## A link is reported missing, but the note exists

- The note is under `_archive/`: archived notes are not link targets, so an old copy never
  stands in for a live note of the same name.
- Several notes share the name: `[[Name]]` resolves to the one with the shortest path. Link
  by path (`[[folder/Name]]`) to pick another.
- An alias works only if no note is named that way.

## "YAML parse error"

The frontmatter is not valid YAML — often a duplicate key, an unclosed `[` or `"`, or a
`:` inside an unquoted value. Fix the YAML; nothing else is checked until it parses.

## The plugin and the CLI disagree

- The plugin does not check wikilinks in the note body; the CLI does with `--check-links`.
- Without `--check-links` the CLI skips link rules (`target_type_key`, `target_folder`, …)
  entirely.
- **Default entity type** in the plugin and `default_type` in the CLI config are separate
  settings.

Otherwise the two give the same verdicts; a difference is a bug worth reporting.

## The CLI did not pick up a change

`obsi-validate` runs `dist/cli.js` from the repository (`bun link`). After `git pull`, run
`bun install && bun run build:cli`. The plugin needs `bun run build` and a plugin reload in
Obsidian.
