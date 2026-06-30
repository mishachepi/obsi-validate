import { describe, test, expect } from "bun:test";
import { join } from "path";
import { loadSchema } from "../src/schema.js";
import {
  validateBodyLinks,
  validateFile,
  validateFiles,
} from "../src/validate.js";
import type { VaultIndex } from "../src/types.js";
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

  test("expected_folder constraint rejects file in wrong folder", async () => {
    const schema = await getSchema();
    const testSchema = {
      ...schema,
      expectedFolderMap: new Map([["task", "tasks"]]),
    };

    const file = {
      path: "wrong/place.md",
      content: "---\ntype_key: task\nstatus: Done\n---",
    };

    const result = validateFile(file, testSchema, opts);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("__path__");
    expect(result.errors[0].message).toContain("tasks/");
  });

  test("expected_folder tolerates trailing slash in schema value", async () => {
    const schema = await getSchema();
    const testSchema = {
      ...schema,
      expectedFolderMap: new Map([["task", "tasks/"]]),
    };

    const file = {
      path: "tasks/my-task.md",
      content: "---\ntype_key: task\nstatus: Done\n---",
    };

    const result = validateFile(file, testSchema, opts);
    expect(result.valid).toBe(true);
  });

  test("expected_folder constraint passes for correct folder", async () => {
    const schema = await getSchema();
    const testSchema = {
      ...schema,
      expectedFolderMap: new Map([["task", "tasks"]]),
    };

    const file = {
      path: "tasks/my-task.md",
      content: "---\ntype_key: task\nstatus: Done\n---",
    };

    const result = validateFile(file, testSchema, opts);
    expect(result.valid).toBe(true);
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

describe("link constraints in property values", () => {
  test("type_key=task + epic with broken wikilink → validation error", async () => {
    const schema = loadSchema(
      [
        {
          path: "/v/entities/task_entity.md",
          content:
            "---\nentity_name: task\nproperties:\n  epic: {}\n  status: { required: true }\n---",
        },
      ],
      [
        {
          path: "/v/properties/type_key_property.md",
          content: "---\nproperty_name: type_key\nproperty_type: string\n---",
        },
        {
          path: "/v/properties/status_property.md",
          content: "---\nproperty_name: status\nproperty_type: string\n---",
        },
        {
          path: "/v/properties/epic_property.md",
          content:
            "---\nproperty_name: epic\nproperty_type: links\ntarget_type_key: epic\n---",
        },
      ],
    );

    // Empty vault index → any wikilink will be "not found"
    const vaultIndex = new Map();

    const file = {
      path: "/v/tasks/some-task.md",
      content: [
        "---",
        "type_key: task",
        "status: In Progress",
        'epic: "[[Nonexistent Epic]]"',
        "---",
      ].join("\n"),
    };

    const result = validateFile(file, schema, {
      typeKeyField: "type_key",
      checkLinks: true,
      vaultIndex,
    });

    expect(result.entityType).toBe("task");
    expect(result.valid).toBe(false);
    const epicErr = result.errors.find((e) => e.field === "epic");
    expect(epicErr).toBeDefined();
    expect(epicErr!.message).toContain("not found in vault");
  });

  test("epic property accepts a single wikilink string (not just array)", async () => {
    const schema = loadSchema(
      [
        {
          path: "/v/entities/task_entity.md",
          content:
            "---\nentity_name: task\nproperties:\n  epic: {}\n---",
        },
      ],
      [
        {
          path: "/v/properties/epic_property.md",
          content:
            "---\nproperty_name: epic\nproperty_type: links\n---",
        },
      ],
    );

    const file = {
      path: "/v/tasks/x.md",
      content: '---\ntype_key: task\nepic: "[[Some Epic]]"\n---',
    };

    const result = validateFile(file, schema, { typeKeyField: "type_key" });
    // No zod failure on the scalar value
    expect(result.errors.find((e) => e.field === "epic")).toBeUndefined();
  });
});

describe("validateBodyLinks", () => {
  function indexWith(...names: string[]): VaultIndex {
    const index: VaultIndex = new Map();
    for (const name of names) index.set(name, { path: `${name}.md`, data: {} });
    return index;
  }

  test("table with valid wikilink in cell produces no errors", () => {
    const content = [
      "---",
      "type_key: person",
      "---",
      "",
      "| Name / Aliases         | Wikilink          |",
      "|:---------------------- |:----------------- |",
      "| Света, Sveta, Светлана | [[Sveta Efimova]] |",
      "",
    ].join("\n");

    const errors = validateBodyLinks(content, indexWith("Sveta Efimova"));
    expect(errors).toHaveLength(0);
  });

  test("[[broken|alias]] reports exactly one broken-link error", () => {
    const content = "---\ntype_key: note\n---\n\n[[NonExistent|Display]]\n";
    const errors = validateBodyLinks(content, indexWith("ExistingNote"));
    expect(errors).toHaveLength(1);
    expect(errors[0].received).toBe("NonExistent");
    expect(errors[0].message).toContain("[[NonExistent]]");
  });

  test("unclosed [[ on a line does not swallow table pipes as alias", () => {
    const content = [
      "---",
      "type_key: note",
      "---",
      "",
      "| col1 | col2 |",
      "|------|------|",
      "| [[Open | thing |",
      "| line2 | [[Sveta Efimova]] |",
      "",
    ].join("\n");

    const errors = validateBodyLinks(content, indexWith("Sveta Efimova"));
    expect(errors).toHaveLength(0);
  });

  test("real pipe-syntax [[target|display]] still resolves to target", () => {
    const content = "---\ntype_key: note\n---\n\nsee [[Real Note|alias]]\n";
    const errors = validateBodyLinks(content, indexWith("Real Note"));
    expect(errors).toHaveLength(0);
  });
});

describe("inline property coercion", () => {
  function numberSchema() {
    return loadSchema(
      [
        {
          path: "/v/entities/day_entity.md",
          content:
            "---\nentity_name: day\nallow_extra: true\nproperties:\n  walk: {}\n  done: {}\n  with: {}\n---",
        },
      ],
      [
        {
          path: "/v/properties/walk_property.md",
          content: "---\nproperty_name: walk\nproperty_type: number\n---",
        },
        {
          path: "/v/properties/done_property.md",
          content: "---\nproperty_name: done\nproperty_type: boolean\n---",
        },
        {
          path: "/v/properties/with_property.md",
          content: "---\nproperty_name: with\nproperty_type: links\n---",
        },
      ],
    );
  }

  const linkOpts = {
    typeKeyField: "type_key",
    checkLinks: true,
    vaultIndex: new Map() as VaultIndex,
  };

  test("numeric inline metric [walk::8000] does not report a type error", () => {
    const file = {
      path: "/v/days/d.md",
      content: "---\ntype_key: day\n---\n\nWalked today [walk::8000]\n",
    };
    const result = validateFile(file, numberSchema(), linkOpts);
    expect(
      result.errors.find((e) => e.field === "__inline__walk"),
    ).toBeUndefined();
  });

  test("non-numeric inline value [walk::abc] still reports a type error", () => {
    const file = {
      path: "/v/days/d.md",
      content: "---\ntype_key: day\n---\n\nbad [walk::abc]\n",
    };
    const result = validateFile(file, numberSchema(), linkOpts);
    expect(
      result.errors.find((e) => e.field === "__inline__walk"),
    ).toBeDefined();
  });

  test("boolean inline value [done::true] does not report a type error", () => {
    const file = {
      path: "/v/days/d.md",
      content: "---\ntype_key: day\n---\n\n[done::true]\n",
    };
    const result = validateFile(file, numberSchema(), linkOpts);
    expect(
      result.errors.find((e) => e.field === "__inline__done"),
    ).toBeUndefined();
  });
});

describe("HTML comment links are ignored", () => {
  test("wikilink inside <!-- ... --> is not validated as a live link", () => {
    const content = [
      "---",
      "type_key: note",
      "---",
      "",
      "real content",
      "<!-- Schema: [[components/entities/area]] -->",
      "",
    ].join("\n");
    const errors = validateBodyLinks(content, new Map());
    expect(errors).toHaveLength(0);
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
