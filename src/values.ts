/** True for a frontmatter value that holds nothing: null, undefined or "". */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** A frontmatter value as a list of non-empty items. A scalar counts as a
 * one-item list (`tags: x` is as legal as `tags: [x]`). */
export function asList(value: unknown): unknown[] {
  const items = Array.isArray(value) ? value : [value];
  return items.filter((v) => !isEmptyValue(v));
}
