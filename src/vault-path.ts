/** Throw unless `path` is a relative path that stays inside the vault.
 * Checks whole segments, so `..` as a segment is rejected while a name that
 * merely contains dots (`v1..2.md`) is fine. Both separators are handled. */
export function assertSafeVaultPath(path: string): void {
  const segments = path.split(/[/\\]+/);
  const absolute = /^[/\\]/.test(path) || /^[A-Za-z]:/.test(path);
  if (!path.trim() || absolute || segments.some((s) => s === "..")) {
    throw new Error(`Unsafe path: ${path}`);
  }
}
