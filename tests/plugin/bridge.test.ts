/**
 * The plugin's bridge (Obsidian vault → validator), run against the same
 * mini vault as tests/cli.test.ts. The plugin and the CLI must agree on every
 * frontmatter verdict; the plugin does not check body links by design.
 */
import { describe, test, expect, mock } from "bun:test";
import { join } from "path";
import { fakeApp, obsidianModule } from "./obsidian-mock.js";

mock.module("obsidian", () => obsidianModule);
const { ensureSchema, bridgeValidateVault, bridgeValidateFile, buildVaultIndex } = await import("../../src/bridge.js");

const ROOT = join(import.meta.dir, "..", "..");
const VAULT = join(import.meta.dir, "..", "fixtures", "mini-vault");
const app = fakeApp(VAULT) as any;
const schema = await ensureSchema(app, "_system", null);
const opts = { typeKeyField: "type_key" };

const fields = (r: { valid: boolean; errors: { field: string }[]; warnings: { field: string }[] }) =>
  [r.valid, r.errors.map((e) => e.field).sort(), r.warnings.map((w) => w.field).sort()];

describe("plugin bridge on the mini vault", () => {
  test("schema loads from the vault and skips _deprecated/", () => {
    expect([...schema.entityMap.keys()].sort()).toEqual(["area", "base", "epic", "page", "task"]);
    expect(schema.properties.find((p) => p.name === "estimate")?.property_type).toBe("number");
  });

  test("_archive/ and _index.md are not validated", async () => {
    const summary = await bridgeValidateVault(app, schema, opts);
    const files = summary.results.map((r) => r.file);
    expect(files.some((f) => f.startsWith("_archive/"))).toBe(false);
    expect(files.some((f) => f.endsWith("_index.md"))).toBe(false);
  });

  test("the link index ignores _archive/, so [[Work]] is the live area", async () => {
    const index = await buildVaultIndex(app);
    expect(index.get("Work")?.path).toBe("areas/Work/Work.md");
    expect([...index.values()].some((e) => e.path.startsWith("_archive/"))).toBe(false);
  });

  test("folder link rules work on vault paths (owner → people/)", async () => {
    const good = app.vault.getAbstractFileByPath("tasks/good.md");
    expect((await bridgeValidateFile(app, good, schema, opts)).valid).toBe(true);
  });

  test("every frontmatter verdict matches the CLI (mdbase engine, --check-links)", async () => {
    const plugin = await bridgeValidateVault(app, schema, opts);
    const p = Bun.spawnSync(
      ["bun", join(ROOT, "src/cli.ts"), VAULT, "--schema-dir", join(VAULT, "_system"), "--check-links", "-f", "json"],
      { cwd: ROOT },
    );
    const cli = JSON.parse(p.stdout.toString());
    // Frontmatter diagnostics only (body-link fields start with "__"); files with none are dropped.
    const issues = (results: any[], rel: (f: string) => string) =>
      Object.fromEntries(
        results
          .map((r) => {
            const errors = r.errors.filter((e: any) => !e.field.startsWith("__"));
            return [rel(r.file), fields({ valid: errors.length === 0, errors, warnings: r.warnings })] as const;
          })
          .filter(([, [, errs, warns]]) => (errs as string[]).length + (warns as string[]).length > 0),
      );
    const cliMap = issues(cli.results, (f) => f.slice(VAULT.length + 1));
    const pluginMap = issues(plugin.results, (f) => f);
    expect(Object.keys(cliMap).length).toBeGreaterThan(10);
    expect(pluginMap).toEqual(cliMap);
  });

  test("defaultEntityType from plugin settings does not make untyped notes fail", async () => {
    const untyped = app.vault.getAbstractFileByPath("notes/untyped.md");
    const r = await bridgeValidateFile(app, untyped, schema, { ...opts, defaultEntityType: "page" });
    expect(r.valid).toBe(true);
    expect(r.entityType).toBe("page");
  });
});
