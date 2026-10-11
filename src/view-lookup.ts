/** First leaf whose view is an instance of `ctor`, or null.
 *
 * Obsidian 1.7+ restores side panels lazily: after a restart the leaf exists
 * but holds a placeholder view until the user reveals it. Matching by class
 * (not by view type alone) keeps callers from invoking our methods on that
 * placeholder. */
export function findView<T>(
  leaves: ReadonlyArray<{ view: unknown }>,
  ctor: abstract new (...args: never[]) => T,
): T | null {
  for (const leaf of leaves) {
    if (leaf.view instanceof ctor) return leaf.view as T;
  }
  return null;
}
