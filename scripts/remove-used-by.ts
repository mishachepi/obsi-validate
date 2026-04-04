/**
 * Remove used_by from property files' frontmatter.
 * Edits YAML text directly to preserve formatting.
 *
 * Usage: bun run scripts/remove-used-by.ts [--dry-run]
 */
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

const VAULT_DIR = "vault/properties";
const DRY_RUN = process.argv.includes("--dry-run");

const entries = await readdir(VAULT_DIR, {
  withFileTypes: true,
  recursive: true,
});

let updated = 0;

for (const e of entries) {
  if (!e.isFile() || !e.name.endsWith(".md") || e.name === "_index.md")
    continue;
  const path = join(e.parentPath ?? e.path, e.name);
  const content = await readFile(path, "utf-8");

  // Check if file has used_by in frontmatter
  if (!content.includes("used_by:")) continue;

  // Remove used_by line(s) from frontmatter
  // Handle both single-line and multi-line array formats
  const lines = content.split("\n");
  const newLines: string[] = [];
  let inUsedBy = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Single-line: used_by: [task, book, area]
    if (line.match(/^used_by:\s*\[/)) {
      updated++;
      if (DRY_RUN) console.log(`${path}: would remove "${line.trim()}"`);
      continue;
    }

    // Multi-line start: used_by:
    if (line.match(/^used_by:\s*$/)) {
      inUsedBy = true;
      updated++;
      if (DRY_RUN) console.log(`${path}: would remove multi-line used_by`);
      continue;
    }

    // Multi-line continuation: - item
    if (inUsedBy && line.match(/^\s+-\s/)) {
      continue;
    } else {
      inUsedBy = false;
    }

    // Single-line: used_by: task (not array)
    if (line.match(/^used_by:\s+\S/)) {
      updated++;
      if (DRY_RUN) console.log(`${path}: would remove "${line.trim()}"`);
      continue;
    }

    newLines.push(line);
  }

  if (!DRY_RUN) {
    await writeFile(path, newLines.join("\n"), "utf-8");
  }
}

console.log(
  `\n${DRY_RUN ? "Would update" : "Updated"}: ${updated} property files`,
);
