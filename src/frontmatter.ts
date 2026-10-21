import matter from "gray-matter";

/** Parse a note's YAML frontmatter; throws on invalid YAML.
 *
 * Always bypasses gray-matter's global cache (any options object does): the
 * cache stores an entry before parsing, so a second call on the same broken
 * text returns empty data instead of throwing, and broken YAML would read as
 * a note without a type. Skipping it also keeps memory flat on large vaults. */
export function parseFrontmatter(content: string): { data: Record<string, any>; content: string } {
  return matter(content, {});
}

function withoutBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/** The leading frontmatter block of a note (opening `---` through the closing
 * `---` line), or "" when the note does not start with one. A byte-order mark
 * is ignored. The closing delimiter must begin a line, as in gray-matter, so
 * `---` inside a value does not end the block. An unclosed block is returned
 * whole and the parser reports it. */
export function frontmatterBlock(content: string): string {
  const text = withoutBom(content);
  if (!text.startsWith("---")) return "";
  const close = text.indexOf("\n---", 3);
  return close === -1 ? text : text.slice(0, close + 4);
}

/** Everything after the frontmatter block. */
export function noteBody(content: string): string {
  const text = withoutBom(content);
  return text.slice(frontmatterBlock(text).length);
}

/** The raw text of a top-level scalar in the frontmatter, unquoted, or null.
 * Used where parsing loses information: YAML turns both `2026-08-18` and a
 * full timestamp into a Date. */
export function rawFrontmatterValue(content: string, key: string): string | null {
  const line = frontmatterBlock(content).match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  return line?.[1].trim().replace(/^["']|["']$/g, "") || null;
}
