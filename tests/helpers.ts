import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { RawFile } from "../src/types.js";

export const FIXTURES = join(import.meta.dir, "fixtures");

export async function readMdFiles(dir: string): Promise<RawFile[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files: RawFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const path = join(e.parentPath ?? e.path, e.name);
    files.push({ path, content: await readFile(path, "utf-8") });
  }
  return files;
}
