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
