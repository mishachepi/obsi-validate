/**
 * Migration script: add properties: block to entity frontmatter
 * based on used_by from property files.
 *
 * Inserts properties block directly into YAML text to avoid
 * gray-matter.stringify mangling dates.
 *
 * Usage: bun run scripts/migrate-entities.ts [--dry-run]
 */
import matter from "gray-matter";
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

const VAULT_DIR = "vault";
const DRY_RUN = process.argv.includes("--dry-run");

type RawFile = { path: string; content: string };

async function readMdFiles(dir: string): Promise<RawFile[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files: RawFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md") || e.name === "_index.md")
      continue;
    const path = join(e.parentPath ?? e.path, e.name);
    files.push({ path, content: await readFile(path, "utf-8") });
  }
  return files;
}

// Step 1: Build entity→properties mapping from property files' used_by
const propertyFiles = await readMdFiles(join(VAULT_DIR, "properties"));
const entityProps = new Map<string, string[]>();

for (const file of propertyFiles) {
  const { data } = matter(file.content);
  if (!data.property_type && data.type_key !== "property") continue;
  const name =
    data.name ?? file.path.split("/").pop()?.replace(".md", "") ?? "";
  const usedBy: string[] = Array.isArray(data.used_by)
    ? data.used_by
    : data.used_by
      ? [data.used_by]
      : [];
  for (const entity of usedBy) {
    if (entity === "all entities") continue;
    if (!entityProps.has(entity)) entityProps.set(entity, []);
    entityProps.get(entity)!.push(name);
  }
}

// Step 2: Update entity files by inserting properties block before closing ---
const entityFiles = await readMdFiles(join(VAULT_DIR, "entities"));
let updated = 0;

for (const file of entityFiles) {
  const { data } = matter(file.content);
  if (data.component_type !== "entity") continue;

  const entityName =
    data.name ??
    file.path
      .split("/")
      .pop()
      ?.replace("_entity.md", "")
      .replace(".md", "") ??
    "";
  const props = entityProps.get(entityName);

  if (!props || props.length === 0) {
    console.log(`SKIP ${entityName} — no properties found`);
    continue;
  }

  if (data.properties) {
    console.log(`SKIP ${entityName} — already has properties block`);
    continue;
  }

  // Build properties YAML block
  const propsYaml = props
    .sort()
    .map((p) => `  ${p}: {}`)
    .join("\n");
  const block = `properties:\n${propsYaml}`;

  // Insert before closing --- by finding the second ---
  const lines = file.content.split("\n");
  const firstSep = lines.indexOf("---");
  let secondSep = -1;
  for (let i = firstSep + 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      secondSep = i;
      break;
    }
  }

  if (secondSep === -1) {
    console.log(`SKIP ${entityName} — can't find closing ---`);
    continue;
  }

  // Insert properties block before closing ---
  lines.splice(secondSep, 0, block);
  const newContent = lines.join("\n");

  if (DRY_RUN) {
    console.log(`\nWOULD UPDATE ${file.path}:`);
    console.log(`  +${props.length} properties: ${props.sort().join(", ")}`);
  } else {
    await writeFile(file.path, newContent, "utf-8");
    console.log(`UPDATED ${file.path}: +${props.length} properties`);
  }
  updated++;
}

console.log(
  `\n${DRY_RUN ? "Would update" : "Updated"}: ${updated} entity files`,
);
