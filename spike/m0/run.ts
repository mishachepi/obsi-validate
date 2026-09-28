/**
 * M0 smoke for the mdbase spike (task lo5-mdbase-m0-smoke).
 * Answers, at runtime, four questions the .d.ts cannot:
 *   1. does `explicit_type_keys: [type_key]` select our types?
 *   2. what do diagnostics look like (disk Collection path vs in-memory path)?
 *   3. how are ISO dates parsed — string or Date? (gray-matter coerces to Date)
 *   4. is there a record-level CEL assertion hook on TypeDefinition? (checked by grep, reported here)
 *
 * Run: bun run spike/m0/run.ts
 */
import { Collection, validateJsonSchemaFrontmatter } from "@callumalpass/mdbase";
import type { TypeDefinition } from "@callumalpass/mdbase";
import matter from "gray-matter";
import { readFile, readdir, rm } from "fs/promises";
import { join } from "path";

const ROOT = join(import.meta.dir);
const RECORDS = join(ROOT, "records");

function hr(title: string) {
  console.log(`\n=== ${title}`);
}

// ---------- Path A: disk-rooted Collection (CLI-shaped) ----------
hr("A. Collection.open + v03Operations().validate() — disk path");
const opened = await Collection.open(ROOT);
if (opened.error) {
  console.log("OPEN ERROR:", opened.error);
} else {
  const col = opened.collection!;
  const ops = col.v03Operations();
  for (const name of (await readdir(RECORDS)).sort()) {
    const r = await ops.validate({ path: `records/${name}` });
    console.log(`\n-- ${name}: valid=${r.valid}`);
    for (const d of r.diagnostics) {
      console.log(
        `   [${d.severity}] ${d.code} field=${d.field ?? "-"} :: ${d.message}` +
          (d.schema_location ? `  @${d.schema_location}` : ""),
      );
    }
  }
  await col.close();
}

// ---------- Path B: in-memory validateJsonSchemaFrontmatter (plugin-shaped) ----------
hr("B. validateJsonSchemaFrontmatter(frontmatter, typeDef) — in-memory path");
// No disk loader here on purpose: the plugin will hold TypeDefinitions in memory
// (translate.ts output), so we build one from the type file's frontmatter directly.
const taskType = matter(await readFile(join(ROOT, "_types", "task.md"), "utf-8")).data as TypeDefinition;
console.log("in-memory TypeDefinition:", taskType.name, "| dialect:", taskType.schema?.dialect, "| fields DSL:", Boolean(taskType.fields));

for (const name of (await readdir(RECORDS)).sort()) {
  const raw = await readFile(join(RECORDS, name), "utf-8");
  const fm = matter(raw).data; // gray-matter — same parser the current engine uses
  const createdType = fm.created instanceof Date ? "Date" : typeof fm.created;
  const errs = validateJsonSchemaFrontmatter(fm, taskType);
  console.log(`\n-- ${name}: errors=${errs.length}  (created parsed as ${createdType})`);
  for (const e of errs) {
    console.log(
      `   [${e.severity ?? "error"}] ${e.code} field=${e.field ?? "-"} :: ${e.message}` +
        (e.expected !== undefined ? ` expected=${JSON.stringify(e.expected)}` : "") +
        (e.actual !== undefined ? ` actual=${JSON.stringify(e.actual)}` : ""),
    );
  }
}

// ---------- Q3 isolated: dates ----------
hr("C. Dates: same record, created as string vs Date");
const okFm = matter(await readFile(join(RECORDS, "ok.md"), "utf-8")).data;
const asDate = validateJsonSchemaFrontmatter(okFm, taskType);
const asString = validateJsonSchemaFrontmatter(
  { ...okFm, created: "2026-09-28", due: "2026-10-01T10:00" },
  taskType,
);
console.log("gray-matter (Date objects) → errors:", asDate.length, asDate.map((e) => `${e.field}:${e.code}`));
console.log("plain strings            → errors:", asString.length);

// ---------- Q4: CEL hook ----------
hr("D. Record-level CEL assertion hook on TypeDefinition");
console.log(
  "TypeDefinition keys that accept expressions: match.expr (type selection), " +
    "collection.projections (computed values), lifecycle.*.if (write hooks). " +
    "No `constraints`/`assert`/`validate.expr` field exists in types/loader.d.ts → NO record-level assertion hook.",
);

// cleanup cache created by Collection.open (keeps the spike dir clean)
await rm(join(ROOT, ".mdbase"), { recursive: true, force: true }).catch(() => {});
