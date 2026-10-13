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

/** Settings files (inside the vault's `.obsidian` folder) that name a template
 * folder: the core Templates plugin and Templater. Templates hold placeholder
 * values, so notes there are not validated. */
export const TEMPLATE_SETTINGS: readonly { file: string; key: string }[] = [
  { file: "templates.json", key: "folder" },
  { file: "plugins/templater-obsidian/data.json", key: "templates_folder" },
];

/** Template folders named in the settings files; `read` returns a file's
 * text, or undefined when it does not exist. */
export function templateFolders(read: (file: string) => string | undefined): string[] {
  const folders = new Set<string>();
  for (const { file, key } of TEMPLATE_SETTINGS) {
    try {
      const value = JSON.parse(read(file) ?? "{}")[key];
      const folder = typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") : "";
      if (folder) folders.add(folder);
    } catch {}
  }
  return [...folders];
}

/** True when a path lies inside one of `folders` (vault-relative folder paths). */
export function isInFolder(path: string, folders: readonly string[]): boolean {
  const p = path.replace(/\\/g, "/");
  return folders.some((f) => p.startsWith(`${f}/`));
}
