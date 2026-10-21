/**
 * End-to-end tests of the CLI binary against tests/fixtures/mini-vault — the
 * same entry point the vault's validate hook calls. Every expectation names
 * the rule it proves; both engines must produce the same verdicts.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
// The operator's own ~/.config/obsi-validate/config.json must not leak into tests.
const CLI_ENV = { ...process.env, XDG_CONFIG_HOME: join(import.meta.dir, "fixtures", "no-config"), VAULT_DIR: "", SCHEMA_DIR: "" };
const VAULT = join(import.meta.dir, "fixtures", "mini-vault");
const SCHEMA = join(VAULT, "_system");

type Summary = {
  total: number;
  valid: number;
  invalid: number;
  skipped: number;
  results: Array<{ file: string; valid: boolean; entityType: string | null; errors: { field: string }[]; warnings: { field: string }[] }>;
};

function cli(...args: string[]) {
  const p = Bun.spawnSync(["bun", join(ROOT, "src/cli.ts"), ...args], { cwd: ROOT, env: CLI_ENV });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

function runJson(...args: string[]): { code: number | null; summary: Summary } {
  const r = cli(...args, "-f", "json");
  return { code: r.code, summary: JSON.parse(r.out) };
}

/** vault-relative file → [valid, error fields, warning fields] */
function verdicts(s: Summary) {
  return Object.fromEntries(
    s.results.map((r) => [
      r.file.slice(VAULT.length + 1),
      [r.valid, r.errors.map((e) => e.field).sort(), r.warnings.map((w) => w.field).sort()],
    ]),
  );
}

// Files with any diagnostic, with --check-links. Files not listed are valid and silent.
const EXPECTED: Record<string, [boolean, string[], string[]]> = {
  "notes/unknown-type.md": [false, ["type_key"], []], // unknown type_key is an error
  "notes/untyped.md": [true, [], ["type_key"]], // no type_key → skipped with a warning
  "notes/yaml-broken.md": [false, ["_yaml"], []],
  "notes/yaml-broken-noeol.md": [false, ["_yaml"], []], // same text in link index and target: no parse cache
  "tasks/bad-code.md": [false, ["code"], []], // custom_validator returning a message
  "tasks/bad-enum.md": [false, ["status"], []],
  "tasks/broken-body-link.md": [true, [], ["__body_link__"]], // body links warn; --strict-links makes them errors
  "tasks/epic-points-at-area.md": [false, ["epic"], []], // target_type_key
  "tasks/estimate-too-big.md": [false, ["estimate"], []], // max_value; _deprecated string twin ignored
  "tasks/inline-epic-wrong.md": [true, [], ["__inline__epic"]], // [epic:: [[Work]]] in the body
  "tasks/missing-dod.md": [false, ["dod"], []], // required_unless, open status
  "tasks/owner-outside-people.md": [false, ["owner"], []], // target_folder
  "tasks/reviewer-without-email.md": [false, ["reviewer"], []], // target_has_property
  "tasks/stage-not-done.md": [false, ["stage"], []], // target_property_value
  "tasks/unknown-field.md": [true, [], ["colour"]], // unknown field warns only
};

describe("CLI on the mini vault", () => {
  for (const engine of ["mdbase", "zod"]) {
    test(`${engine}: every file gets the expected verdict`, () => {
      const { code, summary } = runJson(VAULT, "--schema-dir", SCHEMA, "--check-links", "--engine", engine);
      expect(code).toBe(1);
      expect(verdicts(summary)).toEqual(EXPECTED);
      expect(summary.invalid).toBe(Object.values(EXPECTED).filter(([v]) => !v).length);
    });
  }

  test("--strict-links turns body findings into errors", () => {
    const v = verdicts(runJson(VAULT, "--schema-dir", SCHEMA, "--check-links", "--strict-links").summary);
    expect(v["tasks/broken-body-link.md"]).toEqual([false, ["__body_link__"], []]);
    expect(v["tasks/inline-epic-wrong.md"]).toEqual([false, ["__inline__epic"], []]);
  });

  test("default engine is mdbase and agrees with zod", () => {
    const dflt = runJson(VAULT, "--schema-dir", SCHEMA, "--check-links").summary;
    const zod = runJson(VAULT, "--schema-dir", SCHEMA, "--check-links", "--engine", "zod").summary;
    expect(verdicts(dflt)).toEqual(verdicts(zod));
  });

  test("_archive/, _index.md, template folders and schema files are never validated", () => {
    const { summary } = runJson(VAULT, "--schema-dir", SCHEMA);
    const files = summary.results.map((r) => r.file);
    expect(files.some((f) => f.includes("/_templates/"))).toBe(false); // .obsidian/templates.json
    expect(files.some((f) => f.includes("/_archive/"))).toBe(false);
    expect(files.some((f) => f.endsWith("_index.md"))).toBe(false);
  });

  test("frontmatter verdicts are the same with and without --check-links", () => {
    // Only the link layer may differ: plain mode reads the frontmatter block,
    // --check-links reads the whole file, and both must parse it the same way.
    const shape = (s: Summary) =>
      Object.fromEntries(
        s.results
          .map((r) => [r.file, r.errors.map((e) => e.field).filter((f) => !f.startsWith("__")).sort()] as const)
          .filter(([, errs]) => errs.length > 0),
      );
    const linkFields = new Set(["epic", "owner", "reviewer", "stage"]);
    const withLinks = shape(runJson(VAULT, "--schema-dir", SCHEMA, "--check-links").summary);
    for (const [f, errs] of Object.entries(withLinks)) {
      const rest = errs.filter((e) => !linkFields.has(e));
      if (rest.length) withLinks[f] = rest;
      else delete withLinks[f];
    }
    expect(shape(runJson(VAULT, "--schema-dir", SCHEMA).summary)).toEqual(withLinks);
  });

  test("without --check-links, link rules and body links are not checked", () => {
    const v = verdicts(runJson(VAULT, "--schema-dir", SCHEMA).summary);
    expect(v["tasks/broken-body-link.md"]).toBeUndefined();
    expect(v["tasks/epic-points-at-area.md"]).toBeUndefined();
    expect(v["tasks/bad-enum.md"]).toEqual([false, ["status"], []]);
  });

  test("[[Work]] resolves to the live area, not the _archive copy", () => {
    // tasks/good.md links [[Work]] in its body and areas/Work is the only live one;
    // epics/Launch.md has area: [[Work]] with target_type_key: area.
    const v = verdicts(runJson(VAULT, "--schema-dir", SCHEMA, "--check-links").summary);
    expect(v["tasks/good.md"]).toBeUndefined();
    expect(v["epics/Launch.md"]).toBeUndefined();
  });
});

describe("CLI single-file mode (how the vault hook calls it)", () => {
  const one = (rel: string) =>
    runJson(join(VAULT, rel), "--check-links", "--vault-dir", VAULT, "--schema-dir", SCHEMA);

  test("valid file → exit 0, folder rules see vault-relative paths", () => {
    const { code, summary } = one("tasks/good.md");
    expect(code).toBe(0);
    expect(summary).toMatchObject({ total: 1, valid: 1, invalid: 0 });
  });

  test("invalid file → exit 1 with the field in the JSON", () => {
    const { code, summary } = one("tasks/owner-outside-people.md");
    expect(code).toBe(1);
    expect(summary.results[0].errors.map((e) => e.field)).toEqual(["owner"]);
  });

  test("broken YAML without a trailing newline → exit 1, not skipped", () => {
    const { code, summary } = one("notes/yaml-broken-noeol.md");
    expect(code).toBe(1);
    expect(summary.results[0].errors.map((e) => e.field)).toEqual(["_yaml"]);
  });

  test("unknown type_key → exit 1 (the hook blocks on invalid > 0)", () => {
    expect(one("notes/unknown-type.md").code).toBe(1);
  });
});

describe("CLI without --vault-dir finds the vault itself", () => {
  test("a single file: link checks and folder rules work (nearest folder with _system/entities)", () => {
    // The fixture keeps its schema in _system/, so the vault root is discovered.
    const r = runJson(join(VAULT, "tasks/good.md"), "--check-links");
    expect(r.code).toBe(0);
    expect(r.summary).toMatchObject({ total: 1, valid: 1 });
  });

  test("a sub-folder: links to notes outside it still resolve", () => {
    const { summary } = runJson(join(VAULT, "tasks"), "--check-links");
    const v = verdicts(summary);
    expect(v["tasks/good.md"]).toBeUndefined();
    expect(v["tasks/epic-points-at-area.md"]).toEqual([false, ["epic"], []]);
  });

  test("pretty output names a single file by its vault path", () => {
    const r = cli(join(VAULT, "tasks/bad-enum.md"));
    expect(r.out).toContain("FAIL tasks/bad-enum.md [task]");
  });
});

describe("CLI options and failure modes", () => {
  test("-t filters by entity type", () => {
    const { summary } = runJson(VAULT, "--schema-dir", SCHEMA, "-t", "page");
    expect(summary.total).toBe(2); // people/Alice, people/Bob
  });

  test("--exclude skips a folder", () => {
    const { summary } = runJson(VAULT, "--schema-dir", SCHEMA, "--exclude", "tasks");
    expect(summary.results.some((r) => r.file.includes("/tasks/"))).toBe(false);
  });

  test("pretty output ends with the totals line", () => {
    const r = cli(VAULT, "--schema-dir", SCHEMA);
    expect(r.out.trim().split("\n").pop()).toMatch(/^Total: \d+ \| Valid: \d+ \| Invalid: \d+ \| Skipped: \d+$/);
  });

  test("unknown --engine → exit 1 with a message", () => {
    const r = cli(VAULT, "--schema-dir", SCHEMA, "--engine", "banana");
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown --engine "banana"');
  });

  test("missing target → exit 1", () => {
    expect(cli(join(VAULT, "nope.md"), "--schema-dir", SCHEMA).code).toBe(1);
  });
});

describe("mdbase-export", () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

  test("writes one type per live entity, skips _deprecated, and is deterministic", async () => {
    const a = await mkdtemp(join(tmpdir(), "obsi-export-"));
    const b = await mkdtemp(join(tmpdir(), "obsi-export-"));
    dirs.push(a, b);
    expect(cli("mdbase-export", "--schema-dir", SCHEMA, "--out", a).code).toBe(0);
    expect(cli("mdbase-export", "--schema-dir", SCHEMA, "--out", b).code).toBe(0);
    const types = (await readdir(join(a, "_types"))).sort();
    expect(types).toEqual(["area.md", "base.md", "epic.md", "page.md", "task.md"]);
    for (const t of types) {
      expect(await readFile(join(a, "_types", t), "utf-8")).toBe(await readFile(join(b, "_types", t), "utf-8"));
    }
    expect(await readFile(join(a, "mdbase.yaml"), "utf-8")).toContain("explicit_type_keys:\n    - type_key");
  });
});
