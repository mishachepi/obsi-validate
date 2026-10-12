/**
 * The plugin's bridge, run against a copy of tests/fixtures/mini-vault (the
 * same vault as tests/cli.test.ts). With link checks on, the plugin must give
 * exactly the CLI's verdicts. Schema writes must keep what the editor does not
 * edit.
 */
import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { copyTree, fakeApp, obsidianModule } from "./obsidian-mock.js";

mock.module("obsidian", () => obsidianModule);
const bridge = await import("../../src/bridge.js");
const { resolveTypeKeyField } = await import("../../src/schema.js");

const ROOT = join(import.meta.dir, "..", "..");
const CLI_ENV = { ...process.env, XDG_CONFIG_HOME: join(import.meta.dir, "..", "fixtures", "no-config"), VAULT_DIR: "", SCHEMA_DIR: "" };
const FIXTURE = join(import.meta.dir, "..", "fixtures", "mini-vault");
const VAULT = mkdtempSync(join(tmpdir(), "obsi-plugin-"));
copyTree(FIXTURE, VAULT);
afterAll(() => rmSync(VAULT, { recursive: true, force: true }));

const app = fakeApp(VAULT) as any;
const verdicts = (results: any[], rel: (f: string) => string) =>
  Object.fromEntries(
    results
      .filter((r) => r.errors.length + r.warnings.length > 0)
      .map((r) => [rel(r.file), [r.valid, r.errors.map((e: any) => e.field).sort(), r.warnings.map((w: any) => w.field).sort()]]),
  );

async function pluginOptions(checkLinks: boolean) {
  const schema = await bridge.loadSchemaFromVault(app, "_system");
  const cache = new bridge.LinkIndexCache(app);
  return {
    schema,
    cache,
    options: {
      typeKeyField: resolveTypeKeyField(schema, ""),
      checkLinks,
      vaultIndex: bridge.needsLinkIndex(schema, checkLinks) ? await cache.get() : undefined,
    },
  };
}

describe("plugin bridge on the mini vault", () => {
  test("schema loads from the vault and skips _deprecated/", async () => {
    const schema = await bridge.loadSchemaFromVault(app, "_system/");
    expect([...schema.entityMap.keys()].sort()).toEqual(["area", "base", "epic", "page", "task"]);
    expect(schema.properties.find((p) => p.name === "estimate")?.property_type).toBe("number");
  });

  test("the type field is detected from the schema when the setting is empty", async () => {
    const { options } = await pluginOptions(true);
    expect(options.typeKeyField).toBe("type_key");
  });

  test("every verdict matches the CLI with --check-links", async () => {
    const { schema, options } = await pluginOptions(true);
    const plugin = await bridge.validateVaultNotes(app, schema, options);
    const run = Bun.spawnSync(
      ["bun", join(ROOT, "src/cli.ts"), VAULT, "--schema-dir", join(VAULT, "_system"), "--check-links", "-f", "json"],
      { cwd: ROOT, env: CLI_ENV },
    );
    const cli = JSON.parse(run.stdout.toString());
    expect(Object.keys(verdicts(cli.results, (f) => f)).length).toBeGreaterThan(10);
    expect(verdicts(plugin.results, (f) => f)).toEqual(verdicts(cli.results, (f) => f.slice(VAULT.length + 1)));
    expect(plugin.results.some((r) => r.file.startsWith("_archive/") || r.file.endsWith("_index.md"))).toBe(false);
  });

  test("archived notes lose names to live ones; broken-YAML notes stay link targets", async () => {
    const index = await new bridge.LinkIndexCache(app).get();
    const { resolveLink } = await import("../../src/link-index.js");
    expect(resolveLink(index, "Work")?.path).toBe("areas/Work/Work.md");
    expect(resolveLink(index, "_archive/2025/Work")?.path).toBe("_archive/2025/Work.md");
    expect(resolveLink(index, "yaml-broken")?.path).toBe("notes/yaml-broken.md");
  });

  test("the index cache follows created, renamed and deleted notes", async () => {
    const cache = new bridge.LinkIndexCache(app);
    const { resolveLink } = await import("../../src/link-index.js");
    await cache.get();
    const file = await app.vault.create("notes/Fresh.md", "---\ntype_key: page\n---\n");
    await cache.update(file);
    expect(resolveLink(await cache.get(), "Fresh")).toBeDefined();
    await app.vault.rename(file, "notes/Renamed.md");
    cache.remove("notes/Fresh.md");
    await cache.update(app.vault.getAbstractFileByPath("notes/Renamed.md"));
    const index = await cache.get();
    expect(resolveLink(index, "Fresh")).toBeUndefined();
    expect(resolveLink(index, "Renamed")).toBeDefined();
    rmSync(join(VAULT, "notes/Renamed.md"));
    cache.remove("notes/Renamed.md");
    expect(resolveLink(await cache.get(), "Renamed")).toBeUndefined();
  });
});

describe("schema writes keep what the editor does not edit", () => {
  test("saveEntity keeps the body, unknown keys and required_unless", async () => {
    const path = "_system/entities/task_entity.md";
    writeFileSync(join(VAULT, path), readFileSync(join(VAULT, path), "utf-8").replace(/---\n$/, "---\n") + "\nNotes about tasks.\n");
    await bridge.saveEntity(app, path, {
      name: "task",
      allow_extra: false,
      extends: "base",
      properties: { status: { required: true }, estimate: {}, dod: { required: true }, owner: {} },
    });
    const text = readFileSync(join(VAULT, path), "utf-8");
    expect(text).toContain("Notes about tasks.");
    const { parseFrontmatter } = await import("../../src/frontmatter.js");
    const fm = parseFrontmatter(text).data;
    expect(fm.properties.dod).toEqual({ required_unless: { status: ["Closed", "Rejected"] } });
    expect(fm.properties.estimate).toEqual({});
    expect(Object.keys(fm.properties)).toEqual(["status", "estimate", "dod", "owner"]);
  });

  test("turning required off on a conditional property writes required: false", async () => {
    const path = "_system/entities/task_entity.md";
    await bridge.saveEntity(app, path, {
      name: "task",
      allow_extra: false,
      extends: "base",
      properties: { status: { required: true }, dod: { required: false } },
    });
    const { parseFrontmatter } = await import("../../src/frontmatter.js");
    expect(parseFrontmatter(readFileSync(join(VAULT, path), "utf-8")).data.properties.dod).toEqual({
      required: false,
      required_unless: { status: ["Closed", "Rejected"] },
    });
  });

  test("saveProperty keeps etl and the body, and removes cleared keys", async () => {
    const path = "_system/properties/estimate_property.md";
    writeFileSync(
      join(VAULT, path),
      "---\nproperty_name: estimate\nproperty_type: number\nmin_value: 1\nmax_value: 360\netl:\n  value_map: { small: 45 }\n---\nMinutes.\n",
    );
    await bridge.saveProperty(app, path, { name: "estimate", property_type: "number", max_value: 600 });
    const text = readFileSync(join(VAULT, path), "utf-8");
    const { parseFrontmatter } = await import("../../src/frontmatter.js");
    const fm = parseFrontmatter(text).data;
    expect(fm).toEqual({ property_name: "estimate", property_type: "number", max_value: 600, etl: { value_map: { small: 45 } } });
    expect(text).toContain("Minutes.");
  });

  test("a new schema note is created in a new folder", async () => {
    const path = bridge.schemaFilePath("_system", "property", "mood");
    await bridge.saveProperty(app, path, { name: "mood", property_type: "enum", allowed_values: ["good", "bad"] });
    expect(readFileSync(join(VAULT, "_system/properties/mood_property.md"), "utf-8")).toContain("property_name: mood");
  });

  test("archiveSchemaFile moves the note to _deprecated/ and out of the schema", async () => {
    await bridge.archiveSchemaFile(app, "_system/properties/mood_property.md");
    expect(app.vault.getAbstractFileByPath("_system/properties/_deprecated/mood_property.md")).not.toBeNull();
    const schema = await bridge.loadSchemaFromVault(app, "_system");
    expect(schema.properties.some((p) => p.name === "mood")).toBe(false);
  });

  test("writes outside the vault are refused", async () => {
    await expect(bridge.saveProperty(app, "../escape.md", { name: "x", property_type: "string" })).rejects.toThrow("Unsafe path");
  });
});
