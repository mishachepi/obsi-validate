import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import matter from "gray-matter";
import { validateJsonSchemaFrontmatter, type TypeDefinition } from "@callumalpass/mdbase";
import {
  entityToTypeDef,
  exportMdbase,
  propertyToJsonSchema,
  renderTypeFile,
  translateSchema,
} from "../../src/mdbase/translate.js";
import { fixtureSchema } from "./fixture.js";

const byName = (schema: ReturnType<typeof fixtureSchema>, entity: string, prop: string) =>
  schema.entityMap.get(entity)!.find((p) => p.name === prop)!;

describe("propertyToJsonSchema — mapping table", () => {
  const s = fixtureSchema();
  test("enum keeps numeric members in both spellings", () => {
    expect(propertyToJsonSchema(byName(s, "task", "priority"))).toEqual({ enum: ["High", 1, 2, "1", "2"] });
  });
  test("number carries min/max", () => {
    expect(propertyToJsonSchema(byName(s, "task", "estimate"))).toEqual({ type: "number", minimum: 1, maximum: 360 });
  });
  test("nullable number admits null", () => {
    expect(propertyToJsonSchema(byName(s, "page", "time_budget"))).toEqual({ type: ["number", "null"] });
  });
  test("links = scalar-or-array of strings", () => {
    expect(propertyToJsonSchema(byName(s, "task", "epic"))).toEqual({ type: ["string", "array"], items: { type: "string" } });
  });
  test("list keeps scalar tolerance", () => {
    expect(propertyToJsonSchema(byName(s, "task", "tags"))).toEqual({ type: ["array", "string", "number", "boolean"] });
  });
  test("date → string (mdbase has no date type; Date objects are the adapter's job)", () => {
    expect(propertyToJsonSchema(byName(s, "task", "created"))).toEqual({ type: "string" });
  });
  test("any and unknown → {} (permissive on both engines)", () => {
    expect(propertyToJsonSchema(byName(s, "task", "dod"))).toEqual({});
    expect(propertyToJsonSchema(byName(s, "page", "unknown_prop"))).toEqual({});
  });
});

describe("entityToTypeDef — entity shape", () => {
  const s = fixtureSchema();
  const task = entityToTypeDef(s, "task", "type_key");
  const value = task.schema.value as Record<string, any>;

  test("type_key becomes a const and is required; inherited props are inlined", () => {
    expect(task.kind).toBe("mdbase.type");
    expect(value.properties.type_key).toEqual({ const: "task" });
    expect(value.required.sort()).toEqual(["created", "status", "type_key"].sort());
    expect(value.properties.tags).toBeDefined(); // from base
  });
  test("required_unless → allOf[if/then/else], not plain required", () => {
    expect(value.required).not.toContain("dod");
    expect(value.allOf).toEqual([
      { if: { properties: { status: { enum: ["Closed", "Rejected"] } }, required: ["status"] }, then: {}, else: { required: ["dod"] } },
    ]);
  });
  test("property_patterns → patternProperties; allow_extra → additionalProperties", () => {
    expect(value.patternProperties).toEqual({ "^time_[a-z]+$": {} });
    expect(value.additionalProperties).toBe(false);
    const page = entityToTypeDef(s, "page", "type_key").schema.value as Record<string, any>;
    expect(page.additionalProperties).toBe(true);
    expect(page.patternProperties).toBeUndefined();
  });
  test("link_constraints.target_type_key → collection.links", () => {
    expect(task.collection).toEqual({ links: { epic: { target_type: "epic", validate_exists: true } } });
  });
  test("output is deterministic (sorted properties, sorted types)", () => {
    const a = JSON.stringify(translateSchema(s, "type_key"));
    const b = JSON.stringify(translateSchema(s, "type_key"));
    expect(a).toBe(b);
    expect(translateSchema(s, "type_key").types.map((t) => t.name)).toEqual(["base", "note", "page", "task"]);
  });
});

describe("generated type runs on the real mdbase validator", () => {
  const s = fixtureSchema();
  const def = entityToTypeDef(s, "task", "type_key") as unknown as TypeDefinition;
  const codes = (fm: Record<string, unknown>) => validateJsonSchemaFrontmatter(fm, def).map((e) => `${e.field}:${e.code}`).sort();

  test("valid record → no errors", () => {
    expect(codes({ type_key: "task", status: "Backlog", created: "2026-09-28", dod: "x", priority: 1, epic: "[[E]]", time_wgg: 3 })).toEqual([]);
  });
  test("bad enum, out-of-range number, unknown field", () => {
    expect(codes({ type_key: "task", status: "Doing", created: "2026-09-28", dod: "x", estimate: 0, color: "red" })).toEqual(
      ["color:schema_additional_properties", "estimate:schema_minimum", "status:schema_enum"].sort(),
    );
  });
  test("required_unless: active without dod fails, Closed without dod passes", () => {
    expect(codes({ type_key: "task", status: "Backlog", created: "2026-09-28" })).toContain("dod:schema_required");
    expect(codes({ type_key: "task", status: "Closed", created: "2026-09-28" })).toEqual([]);
  });
});

describe("exportMdbase — files on disk", () => {
  const dirs: string[] = [];
  afterEach(async () => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

  test("writes mdbase.yaml + one _types file per entity; rerun is byte-identical", async () => {
    const s = fixtureSchema();
    const out = await mkdtemp(join(tmpdir(), "obsi-mdbase-"));
    dirs.push(out);
    const first = await exportMdbase(s, "type_key", out);
    expect(first.sort()).toEqual(["_types/base.md", "_types/note.md", "_types/page.md", "_types/task.md", "mdbase.yaml"].sort());
    const snapshot = Object.fromEntries(await Promise.all(first.map(async (f) => [f, await readFile(join(out, f), "utf-8")])));
    await exportMdbase(s, "type_key", out);
    for (const f of first) expect(await readFile(join(out, f), "utf-8")).toBe(snapshot[f]);
    expect((await readdir(join(out, "_types"))).length).toBe(4);

    const yaml = snapshot["mdbase.yaml"];
    expect(yaml.startsWith("spec_version:")).toBe(true);
    expect(yaml).not.toContain("---"); // bare YAML document, not a frontmatter block
    const cfg = matter(`---\n${yaml}---\n`).data as Record<string, any>;
    expect(cfg.settings.explicit_type_keys).toEqual(["type_key"]);
    expect(cfg.settings.types_folder).toBe("_types");
    const parsed = matter(snapshot["_types/task.md"]).data;
    expect(parsed).toEqual(JSON.parse(JSON.stringify(entityToTypeDef(s, "task", "type_key"))));
  });

  test("renderTypeFile round-trips through gray-matter", () => {
    const def = entityToTypeDef(fixtureSchema(), "page", "type_key");
    expect(matter(renderTypeFile(def)).data).toEqual(JSON.parse(JSON.stringify(def)));
  });
});
