/** Which vault files are validated, linked to, or loaded as schema. Shared by
 * the CLI and the plugin so both see the same vault. Paths are vault-relative
 * (or relative to the schema directory), with either separator. */

/** Folders never validated and never linked into: `_archive/` holds retired
 * copies that would otherwise shadow live notes of the same name; `_skill/`
 * holds tool files, not notes. Dot-folders are skipped too. */
export const ALWAYS_SKIPPED_DIRS: ReadonlySet<string> = new Set(["_archive", "_skill"]);

/** Schema files moved to `_deprecated/` (the plugin's Archive action) are no
 * longer part of the schema. */
export const SCHEMA_SKIPPED_DIRS: ReadonlySet<string> = new Set(["_deprecated"]);

function segments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/");
}

/** True when a path lies under a dot-folder, an always-skipped folder, or one
 * of `extra` (config `exclude_dirs`). */
export function isInSkippedDir(path: string, extra?: ReadonlySet<string>): boolean {
  return segments(path)
    .slice(0, -1)
    .some((d) => d.startsWith(".") || ALWAYS_SKIPPED_DIRS.has(d) || (extra?.has(d) ?? false));
}

/** True for files validated as notes: markdown, except folder `_index.md` files. */
export function isValidationTarget(path: string): boolean {
  const name = segments(path).pop() ?? "";
  return name.endsWith(".md") && name !== "_index.md";
}

/** True when a path lies under a dot-folder or one of `extra`. Such files are
 * not part of the vault at all (Obsidian does not see dot-folders); archived
 * files still are, as link targets. */
export function isOutsideVault(path: string, extra?: ReadonlySet<string>): boolean {
  return segments(path)
    .slice(0, -1)
    .some((d) => d.startsWith(".") || (extra?.has(d) ?? false));
}

/** True for a schema definition file, given its path inside entities/ or properties/. */
export function isSchemaFile(path: string): boolean {
  return isValidationTarget(path) && !isInSkippedDir(path, SCHEMA_SKIPPED_DIRS);
}
