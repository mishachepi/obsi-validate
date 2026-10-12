# Troubleshooting

## A note shows no status-bar dot

- **No type field.** The note is skipped. The type field is the **Type key field** setting, or
  when that is empty `type_key` (if the schema declares it) or `entity`. Set **Default entity
  type** to validate untyped notes.
- **The YAML does not parse, or the type field is a list.** The dot is hidden; run **Validate
  current file** to see the error.
- **The note is under `_archive/`, `_skill/` or a dot-folder, or is named `_index.md`.** Such
  notes are never validated, by the plugin or the CLI.

## "Unknown entity type"

No entity has that name. Check the spelling, and that the entity note has `entity_name`, is
under `entities/`, and is not in a `_deprecated/` folder — archived definitions are not part of
the schema.

## A link is reported missing, but the note exists

Links resolve the way Obsidian resolves them, so first check whether the link opens in Obsidian.

- **A path that does not match.** `[[projects/Name]]` needs a file whose path ends in
  `projects/Name`; it does not fall back to any note called `Name`.
- **A name shared by several notes.** A note in the linking note's folder wins, then live notes
  before archived ones, then the one with fewer folders. Link by path (`[[folder/Name]]`) to
  pick another.
- **An alias** works only if no file has that name.

Markdown links (`[text](path)`) are not checked at all.

## A link points to the wrong kind of note

`Linked "X" has type_key="repo", expected one of: epic` means `[[X]]` resolves to a different
note than you meant — usually another note with the same name in a shallower folder. Obsidian
opens the same note, so the link is wrong in Obsidian too; link by path.

## "YAML parse error"

The frontmatter is not valid YAML — often a duplicate key, an unclosed `[` or `"`, or a `:`
inside an unquoted value. Nothing else is checked until it parses.

## The plugin and the CLI disagree

They apply the same rules. Differences come from settings:

- The CLI checks links only with `--check-links`; the plugin checks link constraints always,
  and body links when **Check links in the note body** is on.
- The type field: the plugin's **Type key field** vs the CLI's `--type-key-field` / config.
- **Default entity type** (plugin) and `default_type` (CLI config) are separate settings.
- `exclude_dirs` / `--exclude` exist only in the CLI.
- The plugin runs the Zod engine and the CLI mdbase by default; verdicts are the same, message
  wording differs.

With equal settings, a different verdict is a bug worth reporting.

## The CLI or the plugin did not pick up a change

`obsi-validate` runs `dist/cli.js` from the repository. After `git pull`, run
`bun install && bun run build:cli`; for the plugin, `bun run build` and then reload the plugin
in Obsidian. See [Keeping a source install up to date](getting-started.md#keeping-a-source-install-up-to-date).
