import { describe, test, expect } from "bun:test";
import { join } from "path";
import { loadSchema } from "../src/schema.js";
import { validateFile } from "../src/validate.js";
import { mdbaseShapeEngine } from "../src/mdbase/adapter.js";
import { ALWAYS_SKIPPED_DIRS, isInSkippedDir, isValidationTarget } from "../src/link-index.js";
import { findView } from "../src/view-lookup.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import type { ValidateOptions } from "../src/types.js";
import { readMdFiles } from "./helpers.js";

const SCHEMA_DIR = join(import.meta.dir, "fixtures", "mini-vault", "_system");
const schema = loadSchema(
  await readMdFiles(join(SCHEMA_DIR, "entities")).then((f) => f.filter((x) => !x.path.includes("_deprecated"))),
  await readMdFiles(join(SCHEMA_DIR, "properties")).then((f) => f.filter((x) => !x.path.includes("_deprecated"))),
);
const engines: Record<string, ValidateOptions> = {
  zod: { typeKeyField: "type_key" },
  mdbase: { typeKeyField: "type_key", shapeEngine: mdbaseShapeEngine(schema, "type_key") },
};

describe("default entity type", () => {
  for (const [name, base] of Object.entries(engines)) {
    test(`${name}: an untyped note validated under the default does not fail on type_key`, () => {
      const r = validateFile({ path: "x.md", content: "---\nemail: a@b.c\n---\n" }, schema, { ...base, defaultEntityType: "page" });
      expect(r.valid).toBe(true);
      expect(r.entityType).toBe("page");
      expect(r.warnings).toEqual([{ field: "type_key", message: 'type_key not set, using default "page"' }]);
    });

    test(`${name}: the default type's own rules still apply`, () => {
      const r = validateFile({ path: "x.md", content: "---\nstatus: Backlog\n---\n" }, schema, { ...base, defaultEntityType: "task" });
      expect(r.valid).toBe(false);
      expect(r.errors.map((e) => e.field)).toEqual(["dod"]);
    });

    test(`${name}: a note with no frontmatter at all uses the default too`, () => {
      const r = validateFile({ path: "x.md", content: "just text" }, schema, { ...base, defaultEntityType: "page" });
      expect(r.valid).toBe(true);
    });
  }
});

describe("custom_validator", () => {
  const task = (code: string) => `---\ntype_key: task\nstatus: Closed\ncode: ${code}\n---\n`;
  test("passes when the expression is true", () => {
    expect(validateFile({ path: "t.md", content: task("AB12") }, schema, engines.zod).valid).toBe(true);
  });
  test("a returned string becomes the error message", () => {
    const r = validateFile({ path: "t.md", content: task("nope") }, schema, engines.zod);
    expect(r.errors).toEqual([{ field: "code", message: "code must look like AB12", received: "nope" }]);
  });
  test("a validator that throws is a warning, not a crash", () => {
    const broken = loadSchema(
      [{ path: "e.md", content: "---\nentity_name: t\nproperties:\n  n: {}\n---\n" }],
      [{ path: "p.md", content: "---\nproperty_name: n\nproperty_type: any\ncustom_validator: value.no.such.path\n---\n" }],
    );
    const r = validateFile({ path: "t.md", content: "---\nentity: t\nn: 1\n---\n" }, broken);
    expect(r.valid).toBe(true);
    expect(r.warnings[0].message).toStartWith("Custom validator error:");
  });
});

describe("expected_folder with absolute CLI paths", () => {
  const s = loadSchema(
    [{ path: "e.md", content: "---\nentity_name: note\nexpected_folder: notes/\nproperties: {}\n---\n" }],
    [],
  );
  const file = (path: string) => ({ path, content: "---\nentity: note\n---\n" });
  test("vaultRoot makes an absolute path vault-relative", () => {
    expect(validateFile(file("/v/notes/a.md"), s, { vaultRoot: "/v" }).valid).toBe(true);
    expect(validateFile(file("/v/notes/a.md"), s, { vaultRoot: "/v/" }).valid).toBe(true);
    expect(validateFile(file("/v/other/a.md"), s, { vaultRoot: "/v" }).valid).toBe(false);
  });
  test("without vaultRoot the path is taken as vault-relative (plugin)", () => {
    expect(validateFile(file("notes/a.md"), s).valid).toBe(true);
    expect(validateFile(file("/v/notes/a.md"), s).valid).toBe(false);
  });
});

describe("folders skipped by both CLI and plugin", () => {
  test("archive, skill and dot-folders at any depth", () => {
    expect([...ALWAYS_SKIPPED_DIRS].sort()).toEqual(["_archive", "_skill"]);
    expect(isInSkippedDir("_archive/2025/Work.md")).toBe(true);
    expect(isInSkippedDir("Area/_archive/x.md")).toBe(true);
    expect(isInSkippedDir(".obsidian/plugins/x.md")).toBe(true);
    expect(isInSkippedDir("Area\\_skill\\x.md")).toBe(true);
  });
  test("a file merely named like a skipped folder is not skipped", () => {
    expect(isInSkippedDir("notes/_archive.md")).toBe(false);
    expect(isInSkippedDir("areas/Work/Work.md")).toBe(false);
  });
  test("extra (config) folders", () => {
    expect(isInSkippedDir("drafts/x.md", new Set(["drafts"]))).toBe(true);
    expect(isInSkippedDir("drafts/x.md")).toBe(false);
  });
  test("validation targets: markdown except _index.md", () => {
    expect(isValidationTarget("a/b.md")).toBe(true);
    expect(isValidationTarget("a/_index.md")).toBe(false);
    expect(isValidationTarget("a/board.canvas")).toBe(false);
  });
});

describe("findView — lazily restored panels", () => {
  class Results {
    render() {
      return "ok";
    }
  }
  class Placeholder {}
  test("skips a placeholder view and returns the real one", () => {
    const real = new Results();
    expect(findView([{ view: new Placeholder() }, { view: real }], Results)).toBe(real);
  });
  test("only a placeholder → null, so callers never call our methods on it", () => {
    expect(findView([{ view: new Placeholder() }], Results)).toBeNull();
    expect(findView([], Results)).toBeNull();
  });
});

describe("parseFrontmatter", () => {
  test("broken YAML throws on every call, not only the first", () => {
    const broken = "---\ntype_key: task\nstatus: [unclosed\n---";
    expect(() => parseFrontmatter(broken)).toThrow();
    expect(() => parseFrontmatter(broken)).toThrow();
  });
  test("validateFile reports broken YAML even after the same text was parsed before", () => {
    const content = "---\ntype_key: task\nstatus: [unclosed\n---";
    try {
      parseFrontmatter(content);
    } catch {}
    expect(validateFile({ path: "x.md", content }, schema, engines.zod).errors[0].field).toBe("_yaml");
  });
});
