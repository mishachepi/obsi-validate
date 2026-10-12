/** Directory walks for the CLI, using the same file rules as the plugin (vault-files.ts). */
import { readdir } from "fs/promises";
import { join, relative } from "path";
import { SCHEMA_SKIPPED_DIRS, isInSkippedDir, isOutsideVault, isSchemaFile, isValidationTarget } from "./vault-files.js";

/** Files under `root` whose root-relative path passes `keep`, without
 * descending into folders for which `skipFolder` holds. */
async function walk(root: string, keep: (path: string) => boolean, skipFolder: (path: string) => boolean): Promise<string[]> {
  const found: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (entry.isDirectory()) {
        if (!skipFolder(join(rel, "_"))) await visit(full);
      } else if (entry.isFile() && keep(rel)) {
        found.push(full);
      }
    }
  }
  await visit(root);
  return found;
}

/** Notes to validate: not under dot-folders, `_archive/`, `_skill/` or `exclude`
 * (config `exclude_dirs` + `--exclude`). */
export function walkValidationTargets(root: string, exclude?: ReadonlySet<string>): Promise<string[]> {
  return walk(root, isValidationTarget, (p) => isInSkippedDir(p, exclude));
}

/** Every file a wikilink may resolve to, archived ones included. */
export function walkVaultFiles(root: string, exclude?: ReadonlySet<string>): Promise<string[]> {
  return walk(root, () => true, (p) => isOutsideVault(p, exclude));
}

/** Schema definition files under an entities/ or properties/ folder. */
export function walkSchemaFiles(root: string): Promise<string[]> {
  return walk(root, isSchemaFile, (p) => isInSkippedDir(p, SCHEMA_SKIPPED_DIRS));
}
