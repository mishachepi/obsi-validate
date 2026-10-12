import matter from "gray-matter";

/** Parse a note's YAML frontmatter; throws on invalid YAML.
 *
 * Always bypasses gray-matter's global cache (any options object does): the
 * cache stores an entry before parsing, so a second call on the same broken
 * text returns empty data instead of throwing, and broken YAML would read as
 * a note without type_key. Skipping it also keeps memory flat on large vaults. */
export function parseFrontmatter(content: string): { data: Record<string, any>; content: string } {
  return matter(content, {});
}

/** The leading frontmatter block of a note (opening `---` through the closing
 * `---` line), or "" when the note does not start with one. The closing
 * delimiter must begin a line, as in gray-matter, so `---` inside a value
 * does not cut the block short. An unclosed block is returned whole and the
 * parser reports it. */
export function frontmatterBlock(content: string): string {
  if (!content.startsWith("---")) return "";
  const close = content.indexOf("\n---", 3);
  if (close === -1) return content;
  return content.slice(0, close + 4);
}
