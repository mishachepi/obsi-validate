import { readdir } from "fs/promises";
import { join } from "path";
import { isLinkableFile } from "./link-index.js";

const EMPTY_EXCLUDES: ReadonlySet<string> = new Set();

/** Walk directory recursively, skipping dot-directories.
 *
 * `mode` separates two different questions that must not share exclusions:
 *   "targets" — files to validate. `_index.md` is excluded deliberately.
 *   "index"   — files a wikilink may point AT. Excluding a real file here
 *               turns a valid link into a false "not found", so this mode
 *               keeps `_index.md` and also collects `.canvas` notes, which
 *               Obsidian links to like any other note.
 *
 * `excludeDirs` is user-configured (config `exclude_dirs` + CLI `--exclude`,
 * see config.ts) and is applied in BOTH modes — an excluded directory is
 * skipped for validation AND kept out of the link index, so it can neither
 * be flagged itself nor make a real link elsewhere read as broken by
 * shadowing a basename. It is additive on top of the fixed defaults below,
 * never a replacement for them.
 */
export async function walkVaultFiles(
  dir: string,
  mode: "targets" | "index",
  excludeDirs: ReadonlySet<string> = EMPTY_EXCLUDES,
): Promise<string[]> {
  const paths: string[] = [];

  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      // Skip archive / shadow-override trees: their duplicate-basename notes
      // would shadow canonical notes in the link index (first-wins). Fixed
      // defaults — always on, independent of user-configured excludeDirs.
      if (entry.isDirectory() && (entry.name === "_archive" || entry.name === "_skill")) continue;
      if (entry.isDirectory() && excludeDirs.has(entry.name)) continue;
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (mode === "targets") {
        if (entry.name.endsWith(".md") && entry.name !== "_index.md") paths.push(fullPath);
      } else if (isLinkableFile(entry.name)) {
        paths.push(fullPath);
      }
    }
  }

  await walk(dir);
  return paths;
}

/** Files to validate. */
export async function walkMdFiles(dir: string, excludeDirs?: ReadonlySet<string>): Promise<string[]> {
  return walkVaultFiles(dir, "targets", excludeDirs);
}

/** Files a wikilink may resolve to. */
export async function walkLinkableFiles(dir: string, excludeDirs?: ReadonlySet<string>): Promise<string[]> {
  return walkVaultFiles(dir, "index", excludeDirs);
}
