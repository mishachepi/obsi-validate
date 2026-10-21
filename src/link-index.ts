/** Wikilink resolution, shared by the CLI and the plugin, modelled on
 * Obsidian's resolver:
 * - case-insensitive; a note is reachable by its path without `.md` and by
 *   every shorter path suffix (`a/b/Note`, `b/Note`, `Note`); other files
 *   (canvases, images, pdfs) keep their extension;
 * - when several files match, one in the linking note's own folder wins, then
 *   live files before archived ones, then fewer folders, then alphabetical
 *   (Obsidian's own last resort is its internal file order, which cannot be
 *   reproduced outside the app);
 * - aliases from `aliases:` frontmatter count only for names no file has. */
import type { VaultIndex, VaultIndexEntry } from "./types.js";
import { asList } from "./values.js";
import { isInSkippedDir } from "./vault-files.js";

/** The target of a wikilink, without brackets, embed `!`, alias, heading or
 * block reference. Accepts `[[x]]`, `![[x]]` or the bare inner text; a
 * table-escaped alias pipe (`\|`) is handled. */
export function parseWikilinkTarget(link: string): string {
  let s = link.trim();
  if (s.startsWith("!")) s = s.slice(1);
  if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
  s = s.replace(/\\\|/g, "|");
  for (const sep of ["|", "#"]) {
    const i = s.indexOf(sep);
    if (i >= 0) s = s.slice(0, i);
  }
  return s.trim();
}

function linkKey(target: string): string {
  return target.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
}

function folderOf(path: string): string {
  return path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
}

/** Every key a file is reachable by, longest (its full path) first. */
export function indexKeysFor(path: string): string[] {
  const parts = linkKey(path).split("/");
  return parts.map((_, i) => parts.slice(i).join("/"));
}

/** Alias names from a note's `aliases:` frontmatter (scalar or list). */
export function aliasKeysFor(data: Record<string, unknown> | undefined): string[] {
  return asList(data?.["aliases"])
    .map((v) => String(v).trim())
    .filter(Boolean);
}

/** Build the link index from every file in the vault: vault-relative path plus
 * parsed frontmatter (`{}` for non-notes and for notes whose YAML does not
 * parse — they are still link targets). */
export function buildIndexFromEntries(entries: ReadonlyArray<VaultIndexEntry>): VaultIndex {
  const rank = (e: VaultIndexEntry) => [isInSkippedDir(e.path) ? 1 : 0, e.path.split("/").length] as const;
  const ordered = [...entries].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  });
  const index: VaultIndex = new Map();
  const add = (key: string, entry: VaultIndexEntry) => {
    const list = index.get(key);
    if (list) list.push(entry);
    else index.set(key, [entry]);
  };
  for (const entry of ordered) for (const key of indexKeysFor(entry.path)) add(key, entry);
  const fileKeys = new Set(index.keys());
  for (const entry of ordered) {
    for (const alias of aliasKeysFor(entry.data)) {
      const key = linkKey(alias);
      if (!fileKeys.has(key)) add(key, entry);
    }
  }
  return index;
}

/** The file a wikilink points to, or undefined when it does not resolve.
 * `fromPath` (the linking note's vault path) lets a file in the same folder win. */
export function resolveLink(index: VaultIndex, link: string, fromPath?: string): VaultIndexEntry | undefined {
  const target = parseWikilinkTarget(link);
  const candidates = target ? index.get(linkKey(target)) : undefined;
  if (!candidates) return undefined;
  if (fromPath !== undefined && candidates.length > 1) {
    const folder = folderOf(fromPath);
    const local = candidates.find((c) => folderOf(c.path) === folder);
    if (local) return local;
  }
  return candidates[0];
}
