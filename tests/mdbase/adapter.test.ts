import { describe, test, expect } from "bun:test";
import { validateFile } from "../../src/validate.js";
import { mdbaseShapeEngine } from "../../src/mdbase/adapter.js";
import type { ValidateOptions, ValidationResult, VaultIndex } from "../../src/types.js";
import { fixtureSchema } from "./fixture.js";

const schema = fixtureSchema();
const mdbase = mdbaseShapeEngine(schema, "type_key");
// Fixtures use `created: 2026-01-05` — before the task-intake cutoff (18.08), so
// the bespoke intake detector stays out of the way and only the shape half is compared.

/** Run the same file through both engines. */
function both(content: string, extra: Partial<ValidateOptions> = {}): [ValidationResult, ValidationResult] {
  const file = { path: "tasks/x.md", content };
  const base: ValidateOptions = { typeKeyField: "type_key", ...extra };
  return [validateFile(file, schema, base), validateFile(file, schema, { ...base, shapeEngine: mdbase })];
}

const fields = (r: ValidationResult) => ({
  valid: r.valid,
  errors: r.errors.map((e) => e.field).sort(),
  warnings: r.warnings.map((w) => w.field).sort(),
});

/** Assert both engines agree on validity and on WHICH fields fail/warn. */
function expectParity(content: string, extra?: Partial<ValidateOptions>) {
  const [zod, md] = both(content, extra);
  expect(fields(md)).toEqual(fields(zod));
  return { zod, md };
}

describe("mdbase shape engine — parity with Zod on validateFile()", () => {
  test("valid task (Date from gray-matter, pattern field, scalar list)", () => {
    const { zod } = expectParity("---\ntype_key: task\nstatus: Backlog\ncreated: 2026-01-05\ndod: x\ntags: solo\ntime_wgg: 3\n---\n");
    expect(zod.valid).toBe(true);
  });

  test("bad enum + out-of-range number + unknown field", () => {
    const { md } = expectParity("---\ntype_key: task\nstatus: Doing\ncreated: 2026-01-05\ndod: x\nestimate: 0\ncolor: red\n---\n");
    expect(md.valid).toBe(false);
    expect(md.errors.find((e) => e.field === "estimate")?.expected).toBe("number");
    expect(md.warnings[0]).toEqual({ field: "color", message: "Unknown property for this entity" });
  });

  test("required field missing", () => {
    const { md } = expectParity("---\ntype_key: task\ncreated: 2026-01-05\ndod: x\n---\n");
    expect(md.errors).toEqual([{ field: "status", message: "Required field is missing" }]);
  });

  test("required_unless: Backlog without dod fails, Closed without dod passes", () => {
    expectParity("---\ntype_key: task\nstatus: Backlog\ncreated: 2026-01-05\n---\n");
    const { md } = expectParity("---\ntype_key: task\nstatus: Closed\ncreated: 2026-01-05\n---\n");
    expect(md.valid).toBe(true);
  });

  test("nullable + empty value is skipped; allow_extra suppresses warnings", () => {
    const { md } = expectParity("---\ntype_key: page\ntime_budget: \nsomething_else: 1\n---\n");
    expect(md.valid).toBe(true);
    expect(md.warnings).toEqual([]);
  });

  test("numeric enum member in both spellings; boolean type", () => {
    expectParity("---\ntype_key: task\nstatus: Done\ncreated: 2026-01-05\ndod: x\npriority: 1\ndone: true\n---\n");
    expectParity("---\ntype_key: task\nstatus: Done\ncreated: 2026-01-05\ndod: x\npriority: \"1\"\ndone: yes-string\n---\n");
  });

  test("unknown type_key is reported before any engine runs", () => {
    const { md } = expectParity("---\ntype_key: banana\n---\n");
    expect(md.errors).toEqual([{ field: "type_key", message: "Unknown entity type: banana" }]);
  });

  test("bespoke link_constraints run unchanged on both engines", () => {
    const index: VaultIndex = new Map([["E1", { path: "epics/E1.md", data: { type_key: "page" } }]]);
    const { md } = expectParity("---\ntype_key: task\nstatus: Backlog\ncreated: 2026-01-05\ndod: x\nepic: \"[[E1]]\"\n---\n", { vaultIndex: index });
    expect(md.errors[0].message).toContain('expected one of: epic');
  });
});
