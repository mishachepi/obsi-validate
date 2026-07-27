/** Keys under which a vault file can be reached by a wikilink.
 *
 * Obsidian resolves several spellings of the same target, and the link index
 * must carry all of them or a valid link reads as "not found":
 *
 *   [[Note]]                     basename
 *   [[folder/Note]]              vault-relative path, extension dropped
 *   [[arch.canvas]]              canvas is linked WITH its extension
 *   [[_system/canvases/arch.canvas]]
 *
 * `strong` keys are unique (a full path identifies one file) and always win.
 * `weak` keys can collide across folders, so the first file wins and later
 * ones must not overwrite it — that keeps ambiguous short links stable.
 */
export type IndexKeys = { strong: string[]; weak: string[] };

/** Derive index keys from a vault-relative path (POSIX or Windows separators). */
export function indexKeysFor(relPath: string): IndexKeys {
  const normalized = relPath.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() ?? normalized;

  if (filename.endsWith(".canvas")) {
    // Canvas keeps its extension in both spellings — that is how Obsidian
    // writes the link, so stripping it here would break resolution.
    return { strong: [normalized], weak: [filename] };
  }

  const relNoExt = normalized.replace(/\.md$/, "");
  const basename = filename.replace(/\.md$/, "");
  return { strong: [relNoExt], weak: [basename] };
}

/** True when a path is linkable at all (markdown note or canvas). */
export function isLinkableFile(name: string): boolean {
  return name.endsWith(".md") || name.endsWith(".canvas");
}
