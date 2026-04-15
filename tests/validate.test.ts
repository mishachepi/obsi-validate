import { describe, test, expect } from "bun:test";
import { join } from "path";
import { loadSchema } from "../src/schema.js";
import { validateFile, validateFiles } from "../src/validate.js";
import { FIXTURES, readMdFiles } from "./helpers.js";

async function getSchema() {
  const entityFiles = await readMdFiles(join(FIXTURES, "entities"));
  const propertyFiles = await readMdFiles(join(FIXTURES, "properties"));
  return loadSchema(entityFiles, propertyFiles);
}

// Test fixtures use "type_key" as the entity field
const opts = { typeKeyField: "type_key" };

describe("validateFile", () => {
  test("valid task file passes", async () => {
    const schema = await getSchema();
    const file = {
      path: "test-task.md",
      content: [
        "---",
        "type_key: task",
        "status: In Progress",
        "priority: High",
        "estimate: 4",
        "area: '[[Work]]'",
        "---",
      ].join("\n"),
    };

    const result = validateFile(file, schema, opts);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.entityType).toBe("task");
  });

  test("invalid enum value produces error", async () => {
    const schema = await getSchema();
    const file = {
      path: "bad-task.md",
      content: "---\ntype_key: task\nstatus: InvalidStatus\n---",
    };

    const result = validateFile(file, schema, opts);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].field).toBe("status");
  });

  test("number exceeding max produces error", async () => {
    const schema = await getSchema();
    const file = {
      path: "over-estimate.md",
      content: "---\ntype_key: task\nstatus: Done\nestimate: 20\n---",
    };

    const result = validateFile(file, schema, opts);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("estimate");
  });

  test("unknown field produces warning", async () => {
    const schema = await getSchema();
    const file = {
      path: "extra-field.md",
      content:
        "---\ntype_key: task\nstatus: Done\nnonexistent_field: hello\n---",
    };

    const result = validateFile(file, schema, opts);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].field).toBe("nonexistent_field");
  });

  test("missing type_key skips file", async () => {
    const schema = await getSchema();
    const file = {
      path: "no-type.md",
      content: "---\ntitle: Just a note\n---",
    };

    const result = validateFile(file, schema, opts);
    expect(result.entityType).toBeNull();
    expect(result.warnings[0].message).toContain("Missing type_key");
  });

  test("unknown entity type warns", async () => {
    const schema = await getSchema();
    const file = {
      path: "unknown.md",
      content: "---\ntype_key: spaceship\n---",
    };

    const result = validateFile(file, schema, opts);
    expect(result.warnings[0].message).toContain("Unknown entity type");
  });

  test("missing required field produces error", async () => {
    const schema = await getSchema();
    const file = {
      path: "no-status.md",
      content: "---\ntype_key: task\npriority: High\n---",
    };

    const result = validateFile(file, schema, opts);
    expect(result.valid).toBe(false);
    const statusError = result.errors.find((e) => e.field === "status");
    expect(statusError).toBeDefined();
    expect(statusError!.message).toContain("Required");
  });

  test("missing optional field is fine", async () => {
    const schema = await getSchema();
    const file = {
      path: "minimal-task.md",
      content: "---\ntype_key: task\nstatus: Backlog\n---",
    };

    const result = validateFile(file, schema, opts);
    expect(result.valid).toBe(true);
  });

  test("YAML parse error counts as invalid not skipped", async () => {
    const schema = await getSchema();
    const files = [
      {
        path: "broken.md",
        content: "---\nkey: value\nkey: duplicate\n---",
      },
    ];

    const summary = validateFiles(files, schema, opts);
    expect(summary.invalid).toBe(1);
    expect(summary.skipped).toBe(0);
  });

  test("allow_extra suppresses unknown field warnings", async () => {
    const schema = await getSchema();
    // Build a minimal schema with allow_extra: true
    const testSchema = {
      ...schema,
      entityMap: new Map(schema.entityMap),
      allowExtraMap: new Map(schema.allowExtraMap),
    };
    testSchema.allowExtraMap.set("task", true);

    const file = {
      path: "extra-ok.md",
      content:
        "---\ntype_key: task\nstatus: Done\nrandom_field: hello\n---",
    };

    const result = validateFile(file, testSchema, opts);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test("property without file is recognized but not validated", async () => {
    const schema = await getSchema();
    // Build a schema with an extra property that has no validator
    const testSchema = {
      ...schema,
      entityMap: new Map(schema.entityMap),
      allowExtraMap: new Map(schema.allowExtraMap),
    };
    const taskProps = [...schema.entityMap.get("task")!];
    taskProps.push({ name: "custom_field", property_type: "unknown", required: false });
    testSchema.entityMap.set("task", taskProps);

    const file = {
      path: "custom.md",
      content: "---\ntype_key: task\nstatus: Done\ncustom_field: anything\n---",
    };

    const result = validateFile(file, testSchema, opts);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe("validateFiles", () => {
  test("summary counts are correct", async () => {
    const schema = await getSchema();
    const files = [
      { path: "valid.md", content: "---\ntype_key: task\nstatus: Done\n---" },
      {
        path: "invalid.md",
        content: "---\ntype_key: task\nstatus: Nope\n---",
      },
      { path: "skipped.md", content: "---\ntitle: hi\n---" },
    ];

    const summary = validateFiles(files, schema, opts);
    expect(summary.total).toBe(3);
    expect(summary.valid).toBe(1);
    expect(summary.invalid).toBe(1);
    expect(summary.skipped).toBe(1);
  });
});
