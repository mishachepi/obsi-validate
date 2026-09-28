/**
 * Parity harness: the same documents through both shape engines, one case per
 * behaviour class of validate.test.ts. A case passes when both engines agree
 * on validity AND on which fields error / warn. Messages are engine-specific
 * by design and are not compared.
 *
 * Deliberately NOT covered: task-intake detector and --check-links / inline
 * properties. They are bespoke code that runs byte-identically after the
 * engine on both paths, so they prove nothing about mdbase.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { validateFile } from "../../src/validate.js";
import { mdbaseShapeEngine } from "../../src/mdbase/adapter.js";
import type { ValidateOptions, VaultIndex } from "../../src/types.js";
import { fixtureSchema } from "./fixture.js";

const schema = fixtureSchema();
const mdbase = mdbaseShapeEngine(schema, "type_key");
const index: VaultIndex = new Map([
  ["E1", { path: "epics/E1.md", data: { type_key: "epic" } }],
  ["P1", { path: "pages/P1.md", data: { type_key: "page" } }],
]);

type Case = { category: string; name: string; path?: string; fm: string; expectValid: boolean };

// `created: 2026-01-05` keeps every task below the intake cutoff (18.08).
const T = "type_key: task\nstatus: Backlog\ncreated: 2026-01-05\ndod: x\n";

const cases: Case[] = [
  { category: "enum", name: "valid member", fm: T, expectValid: true },
  { category: "enum", name: "invalid member", fm: "type_key: task\nstatus: Doing\ncreated: 2026-01-05\ndod: x\n", expectValid: false },
  { category: "enum", name: "numeric member as number", fm: T + "priority: 1\n", expectValid: true },
  { category: "enum", name: "numeric member as string", fm: T + 'priority: "1"\n', expectValid: true },
  { category: "number", name: "within range", fm: T + "estimate: 90\n", expectValid: true },
  { category: "number", name: "above max", fm: T + "estimate: 999\n", expectValid: false },
  { category: "number", name: "string instead of number", fm: T + "estimate: many\n", expectValid: false },
  { category: "boolean", name: "true", fm: T + "done: true\n", expectValid: true },
  { category: "boolean", name: "string instead of boolean", fm: T + "done: yes-please\n", expectValid: false },
  { category: "required", name: "status missing", fm: "type_key: task\ncreated: 2026-01-05\ndod: x\n", expectValid: false },
  { category: "required", name: "optional missing is fine", fm: T, expectValid: true },
  { category: "unknown-field", name: "warns, stays valid", fm: T + "color: red\n", expectValid: true },
  { category: "unknown-field", name: "allow_extra suppresses warning", fm: "type_key: page\nwhatever: 1\n", expectValid: true },
  { category: "property_patterns", name: "family key accepted", fm: T + "time_wgg: 3\n", expectValid: true },
  { category: "property_patterns", name: "outside family still warns", fm: T + "hours_x: 3\n", expectValid: true },
  { category: "list", name: "array", fm: T + "tags:\n  - a\n  - b\n", expectValid: true },
  { category: "list", name: "scalar tolerated", fm: T + "tags: solo\n", expectValid: true },
  { category: "list", name: "mapping is not a list", fm: T + "tags:\n  k: v\n", expectValid: false },
  { category: "links", name: "single wikilink string", fm: T + 'epic: "[[E1]]"\n', expectValid: true },
  { category: "links", name: "array of wikilinks", fm: T + 'epic:\n  - "[[E1]]"\n', expectValid: true },
  { category: "any", name: "list where prose is usual", fm: "type_key: task\nstatus: Backlog\ncreated: 2026-01-05\ndod:\n  - one\n  - two\n", expectValid: true },
  { category: "date", name: "bare ISO date (Date object from gray-matter)", fm: T, expectValid: true },
  { category: "date", name: "ISO with time", fm: "type_key: task\nstatus: Backlog\ncreated: 2026-01-05T10:00\ndod: x\n", expectValid: true },
  { category: "nullable", name: "empty value on nullable number", fm: "type_key: page\ntime_budget:\n", expectValid: true },
  { category: "nullable", name: "null on nullable number", fm: "type_key: page\ntime_budget: null\n", expectValid: true },
  { category: "nullable", name: "wrong type still fails", fm: "type_key: page\ntime_budget: lots\n", expectValid: false },
  { category: "required_unless", name: "Closed without dod is valid", fm: "type_key: task\nstatus: Closed\ncreated: 2026-01-05\n", expectValid: true },
  { category: "required_unless", name: "Rejected without dod is valid", fm: "type_key: task\nstatus: Rejected\ncreated: 2026-01-05\n", expectValid: true },
  { category: "required_unless", name: "open without dod is invalid", fm: "type_key: task\nstatus: Backlog\ncreated: 2026-01-05\n", expectValid: false },
  { category: "required_unless", name: "missing status does not exempt", fm: "type_key: task\ncreated: 2026-01-05\n", expectValid: false },
  { category: "required_unless", name: "comparison is exact (closed ≠ Closed)", fm: "type_key: task\nstatus: closed\ncreated: 2026-01-05\n", expectValid: false },
  // `dod` is `any` here, so null is a legal value; the point is that the KEY
  // being present satisfies `required` on both engines (the _templates/Task.md case).
  { category: "required_unless", name: "dod: null keeps the key (template case)", fm: "type_key: task\nstatus: Backlog\ncreated: 2026-01-05\ndod: null\n", expectValid: true },
  { category: "link_constraints (bespoke)", name: "target has right type", fm: T + 'epic: "[[E1]]"\n', expectValid: true },
  { category: "link_constraints (bespoke)", name: "target has wrong type", fm: T + 'epic: "[[P1]]"\n', expectValid: false },
  { category: "link_constraints (bespoke)", name: "target missing", fm: T + 'epic: "[[Nope]]"\n', expectValid: false },
  { category: "expected_folder (bespoke)", name: "right folder", path: "notes/n.md", fm: "type_key: note\n", expectValid: true },
  { category: "expected_folder (bespoke)", name: "wrong folder", path: "elsewhere/n.md", fm: "type_key: note\n", expectValid: false },
  { category: "type_key", name: "unknown entity type", fm: "type_key: banana\n", expectValid: false },
  { category: "type_key", name: "missing → skipped", fm: "title: no type\n", expectValid: true },
  { category: "type_key", name: "non-string", fm: "type_key:\n  - task\n", expectValid: false },
];

const tally = new Map<string, { match: number; total: number }>();

describe("mdbase ↔ zod parity (validate.test.ts behaviour classes)", () => {
  for (const c of cases) {
    test(`${c.category} — ${c.name}`, () => {
      const file = { path: c.path ?? "tasks/x.md", content: `---\n${c.fm}---\nbody\n` };
      const base: ValidateOptions = { typeKeyField: "type_key", vaultIndex: index };
      const shape = (r: ReturnType<typeof validateFile>) => ({
        valid: r.valid,
        errors: r.errors.map((e) => e.field).sort(),
        warnings: r.warnings.map((w) => w.field).sort(),
      });
      const zod = shape(validateFile(file, schema, base));
      const md = shape(validateFile(file, schema, { ...base, shapeEngine: mdbase }));

      const t = tally.get(c.category) ?? { match: 0, total: 0 };
      t.total++;
      if (JSON.stringify(zod) === JSON.stringify(md)) t.match++;
      tally.set(c.category, t);

      expect(zod.valid).toBe(c.expectValid); // the case itself is well-formed
      expect(md).toEqual(zod); // and the engines agree
    });
  }

  afterAll(() => {
    const rows = [...tally.entries()].map(([cat, t]) => `  ${cat.padEnd(28)} ${t.match}/${t.total}`);
    const all = [...tally.values()].reduce((a, t) => ({ match: a.match + t.match, total: a.total + t.total }), { match: 0, total: 0 });
    console.log(`\nparity by category (match/total):\n${rows.join("\n")}\n  ${"TOTAL".padEnd(28)} ${all.match}/${all.total}\n`);
  });
});
