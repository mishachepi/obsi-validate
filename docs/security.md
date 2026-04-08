# Security

## Trust Model

property-validator operates within the user's own vault. Schema files (entities, properties) are authored by the vault owner and stored as regular markdown files. The tool trusts schema content the same way a user trusts their own vault files.

**Key assumption:** The person running validation is the vault owner (or trusts the vault content).

## Custom Validators

Custom validators (`custom_validator` field in property files) execute JavaScript expressions at validation time. This is intentional -- it allows vault owners to define complex validation rules in their schema.

**Risks:**
- Arbitrary code execution within the validation process
- Expression runs with the same permissions as the CLI/plugin process

**Mitigations:**
- Only expressions from the vault owner's own schema files are executed
- Syntax errors in expressions produce warnings, not crashes
- Validators receive only the field `value` -- no access to other fields, files, or APIs
- Plugin runs in Obsidian's sandboxed environment

**Recommendations:**
- Do not use custom validators from untrusted sources
- Review `custom_validator` fields before syncing shared vaults
- Keep validator expressions simple (boolean checks, regex, arithmetic)

## File Operations

### Plugin
- Reads files via `app.vault.cachedRead()` (Obsidian API)
- Writes only to `{schema_dir}/entities/` and `{schema_dir}/properties/` directories
- Archive moves files to `_deprecated/` subdirectory (no actual deletion)
- Obsidian Vault API prevents path traversal outside the vault

### CLI
- Reads files via `fs/promises` (Node.js)
- Read-only: CLI never modifies vault files
- Paths come from CLI flags, env vars, or config file

## YAML Handling

- gray-matter parses YAML frontmatter. Invalid YAML produces a validation error (caught, not thrown)
- yamlWriter uses manual string concatenation (not gray-matter.stringify) to avoid date coercion issues
- Special characters in YAML values are quoted (`:`, `#`, `'`, `"`, newlines, boolean literals)

## Vault Index

For link constraint validation, the plugin builds a `VaultIndex` -- a map of note names to frontmatter data. This index:
- Is built only when link constraints exist in the schema
- Lives in memory during validation, discarded after
- Contains only frontmatter data (not file content)

## Dependencies

| Package | Purpose | Risk |
|---------|---------|------|
| `gray-matter` | YAML frontmatter parsing | Well-maintained, fs import shimmed to empty |
| `zod` | Schema validation | No side effects, pure validation |
| `commander` | CLI argument parsing (CLI only) | Not bundled in plugin |
| `obsidian` | Plugin API (external, provided by host) | |
| `esbuild` | Build tool (dev only) | Not in runtime |
