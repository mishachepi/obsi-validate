import { describe, test, expect } from "bun:test";
import { join } from "path";
import { loadSchema } from "../src/schema.js";
import {
  validateBodyLinks,
  validateFile,
  validateFiles,
} from "../src/validate.js";
import type { VaultIndex } from "../src/types.js";
import { indexKeysFor, isLinkableFile } from "../src/link-index.js";
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

  // Scalar tolerance for `list` properties (user ruling 18.08): both YAML
  // representations of a one-element list are legal. `assignee` is
  // property_type: list and the scalar form used to fail with
  // "Expected array, received string" on hand-written notes.
  describe("list property scalar tolerance", () => {
    const listSchema = () =>
      loadSchema(
        [
          {
            path: "/v/entities/task_entity.md",
            content: "---\nentity_name: task\nproperties:\n  assignee: {}\n---",
          },
        ],
        [
          {
            path: "/v/properties/assignee_property.md",
            content: "---\nproperty_name: assignee\nproperty_type: list\n---",
          },
        ],
      );

    test("scalar string is accepted as a one-item list", async () => {
      const schema = await listSchema();
      const file = {
        path: "/v/tasks/x.md",
        content: '---\ntype_key: task\nassignee: "[[Mikhail Chepkin]]"\n---',
      };
      const result = validateFile(file, schema, { typeKeyField: "type_key" });
      expect(result.errors.find((e) => e.field === "assignee")).toBeUndefined();
    });

    test("YAML block list is still accepted", async () => {
      const schema = await listSchema();
      const file = {
        path: "/v/tasks/x.md",
        content: [
          "---",
          "type_key: task",
          "assignee:",
          '  - "[[Mikhail Chepkin]]"',
          '  - "[[agent-area-vault-tools]]"',
          "---",
        ].join("\n"),
      };
      const result = validateFile(file, schema, { typeKeyField: "type_key" });
      expect(result.errors.find((e) => e.field === "assignee")).toBeUndefined();
    });

    test("a YAML mapping where a list belongs still fails", async () => {
      const schema = await listSchema();
      const file = {
        path: "/v/tasks/x.md",
        content: [
          "---",
          "type_key: task",
          "assignee:",
          "  name: broken",
          "---",
        ].join("\n"),
      };
      const result = validateFile(file, schema, { typeKeyField: "type_key" });
      expect(result.errors.find((e) => e.field === "assignee")).toBeDefined();
    });
  });

  describe("task intake detector", () => {
    const taskSchema = () =>
      loadSchema(
        [
          {
            path: "/v/entities/task_entity.md",
            content: "---\nentity_name: task\nproperties:\n  assignee: {}\n---",
          },
        ],
        [],
      );
    const opts = { typeKeyField: "type_key" };
    const intakeErrors = (result: { errors: { field: string; message: string }[] }) =>
      result.errors.filter((e) => ["created", "created_by", "epic"].includes(e.field));

    test("canonical post-cutoff task passes", async () => {
      const schema = await taskSchema();
      const file = {
        path: "/v/tasks/new.md",
        content: [
          "---",
          "type_key: task",
          "created: 2026-08-19T10:15:00.000+02:00",
          "created_by:",
          '  - "[[agent-core]]"',
          "epic:",
          '  - "[[LO5 - Obsi Pydantic]]"',
          "---",
        ].join("\n"),
      };
      expect(intakeErrors(validateFile(file, schema, opts))).toEqual([]);
    });

    test("legacy pre-cutoff task is grandfathered (date-only created, no created_by/epic)", async () => {
      const schema = await taskSchema();
      const file = {
        path: "/v/tasks/old.md",
        content: "---\ntype_key: task\ncreated: 2026-04-19\n---",
      };
      expect(intakeErrors(validateFile(file, schema, opts))).toEqual([]);
    });

    test("post-cutoff task with date-only created fails on all three, message points to obsi-tasks", async () => {
      const schema = await taskSchema();
      const file = {
        path: "/v/tasks/handwritten.md",
        content: "---\ntype_key: task\ncreated: 2026-08-19\n---",
      };
      const errs = intakeErrors(validateFile(file, schema, opts));
      expect(errs.map((e) => e.field).sort()).toEqual(["created", "created_by", "epic"]);
      for (const e of errs) expect(e.message).toContain("obsi-tasks");
    });

    test("task without created is grandfathered (448 legacy tasks carry none)", async () => {
      const schema = await taskSchema();
      const file = {
        path: "/v/tasks/no-created.md",
        content: "---\ntype_key: task\n---",
      };
      expect(intakeErrors(validateFile(file, schema, opts))).toEqual([]);
    });

    test("empty epic list and two-author created_by both fail", async () => {
      const schema = await taskSchema();
      const file = {
        path: "/v/tasks/partial.md",
        content: [
          "---",
          "type_key: task",
          "created: 2026-08-19T10:15:00.000+02:00",
          "created_by:",
          '  - "[[agent-core]]"',
          '  - "[[Mikhail Chepkin]]"',
          "epic: []",
          "---",
        ].join("\n"),
      };
      const errs = intakeErrors(validateFile(file, schema, opts));
      expect(errs.map((e) => e.field).sort()).toEqual(["created_by", "epic"]);
    });

    test("scalar created_by and scalar epic are accepted (vault-wide scalar tolerance)", async () => {
      const schema = await taskSchema();
      const file = {
        path: "/v/tasks/scalar.md",
        content: [
          "---",
          "type_key: task",
          'created: "2026-08-19T10:15:00.000+02:00"',
          'created_by: "[[agent-core]]"',
          'epic: "[[LO5 - Obsi Pydantic]]"',
          "---",
        ].join("\n"),
      };
      expect(intakeErrors(validateFile(file, schema, opts))).toEqual([]);
    });

    test("non-task entities are untouched by the detector", async () => {
      const schema = await loadSchema(
        [
          {
            path: "/v/entities/epic_entity.md",
            content: "---\nentity_name: epic\nproperties: {}\n---",
          },
        ],
        [],
      );
      const file = {
        path: "/v/epics/e.md",
        content: "---\ntype_key: epic\ncreated: 2026-08-19\n---",
      };
      expect(intakeErrors(validateFile(file, schema, opts))).toEqual([]);
    });
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

  test("escaped-pipe [[target\\|alias]] in a table cell resolves to target", () => {
    const content = [
      "---",
      "type_key: note",
      "---",
      "",
      "| Activity | Link |",
      "|----------|------|",
      "| Climb    | [[HO2 - Climbing Start\\|Climbing]] |",
      "",
    ].join("\n");
    const errors = validateBodyLinks(content, indexWith("HO2 - Climbing Start"));
    expect(errors).toHaveLength(0);
  });

  test("wikilinks inside a fenced code block are ignored", () => {
    const content = [
      "---",
      "type_key: note",
      "---",
      "",
      "```markdown",
      "example: [[Epic A]] links to [[Area B]]",
      "```",
      "",
      "real [[Real Note]]",
      "",
    ].join("\n");
    const errors = validateBodyLinks(content, indexWith("Real Note"));
    expect(errors).toHaveLength(0);
  });

  test("wikilink inside inline code is ignored", () => {
    const content = "---\ntype_key: note\n---\n\nuse `[[Fake Link]]` syntax\n";
    const errors = validateBodyLinks(content, new Map());
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

describe("link index keys (canvas + path-style wikilinks)", () => {
  test("markdown note is reachable by path and by basename", () => {
    const { strong, weak } = indexKeysFor("_system/entities/_index.md");
    expect(strong).toEqual(["_system/entities/_index"]);
    expect(weak).toEqual(["_index"]);
  });

  test("canvas keeps its extension in both spellings", () => {
    // Obsidian writes [[arch.canvas]] — dropping the extension breaks resolution.
    const { strong, weak } = indexKeysFor("_system/canvases/arch.canvas");
    expect(strong).toEqual(["_system/canvases/arch.canvas"]);
    expect(weak).toEqual(["arch.canvas"]);
  });

  test("root-level note yields the same key twice, harmlessly", () => {
    const { strong, weak } = indexKeysFor("Note.md");
    expect(strong).toEqual(["Note"]);
    expect(weak).toEqual(["Note"]);
  });

  test("windows separators normalize to forward slashes", () => {
    expect(indexKeysFor("a\\b\\c.md").strong).toEqual(["a/b/c"]);
  });

  test("only markdown and canvas are linkable", () => {
    expect(isLinkableFile("a.md")).toBe(true);
    expect(isLinkableFile("a.canvas")).toBe(true);
    expect(isLinkableFile("a.png")).toBe(false);
    expect(isLinkableFile("a.pdf")).toBe(false);
  });
});

describe("wikilink resolution against a path-keyed index", () => {
  /** Index built the way the CLI builds it: strong keys win, weak are first-wins. */
  function indexFrom(...relPaths: string[]): VaultIndex {
    const index: VaultIndex = new Map();
    for (const rel of relPaths) {
      const { strong, weak } = indexKeysFor(rel);
      const entry = { path: rel, data: {} };
      for (const k of strong) index.set(k, entry);
      for (const k of weak) if (!index.has(k)) index.set(k, entry);
    }
    return index;
  }

  const body = (link: string) => `---\ntype_key: page\n---\n\nsee ${link}\n`;

  test("existing canvas embed resolves", () => {
    const errors = validateBodyLinks(
      body("![[arch.canvas]]"),
      indexFrom("_system/canvases/arch.canvas"),
    );
    expect(errors).toHaveLength(0);
  });

  test("canvas by full path resolves", () => {
    const errors = validateBodyLinks(
      body("[[_system/canvases/arch.canvas]]"),
      indexFrom("_system/canvases/arch.canvas"),
    );
    expect(errors).toHaveLength(0);
  });

  test("MISSING canvas still errors — the fix must not blanket-skip canvas", () => {
    const errors = validateBodyLinks(body("![[gone.canvas]]"), indexFrom("_system/canvases/arch.canvas"));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("gone.canvas");
  });

  test("path-style wikilink to an _index note resolves", () => {
    const errors = validateBodyLinks(
      body("[[_system/entities/_index]]"),
      indexFrom("_system/entities/_index.md"),
    );
    expect(errors).toHaveLength(0);
  });

  test("path-style wikilink to a missing note still errors", () => {
    const errors = validateBodyLinks(
      body("[[_system/entities/nope]]"),
      indexFrom("_system/entities/_index.md"),
    );
    expect(errors).toHaveLength(1);
  });

  test("path-style link with alias and heading resolves", () => {
    const errors = validateBodyLinks(
      body("[[_system/entities/_index#Types|the index]]"),
      indexFrom("_system/entities/_index.md"),
    );
    expect(errors).toHaveLength(0);
  });

  test("ambiguous basename stays first-wins", () => {
    const index = indexFrom("a/Dup.md", "b/Dup.md");
    expect(index.get("Dup")!.path).toBe("a/Dup.md");
    // …while each full path still resolves to its own file
    expect(index.get("a/Dup")!.path).toBe("a/Dup.md");
    expect(index.get("b/Dup")!.path).toBe("b/Dup.md");
  });
});

describe("property_patterns — open key families", () => {
  // The day ETL invents keys at runtime (time_<area>, <category>_hours), and the
  // set changes on every Area rename. Enumerating it does not converge: a single
  // live run over days/2026 surfaced 8 more historical names right after ~15 had
  // been registered by hand. Patterns say "this family is expected"; allow_extra
  // would say "nothing is unexpected", which stops catching real regressions.

  const patternEntity = [
    "---",
    "entity_name: metered_day",
    "property_patterns:",
    '  - "^time_"',
    '  - "_hours$"',
    "properties:",
    "  date:",
    "    required: true",
    "---",
  ].join("\n");

  async function schemaWithPatterns() {
    const entityFiles = await readMdFiles(join(FIXTURES, "entities"));
    const propertyFiles = await readMdFiles(join(FIXTURES, "properties"));
    entityFiles.push({ path: "metered_day.md", content: patternEntity });
    return loadSchema(entityFiles, propertyFiles);
  }

  const fileWith = (fields: string[]) => ({
    path: "day.md",
    content: ["---", "type_key: metered_day", "date: 2026-08-03", ...fields, "---", ""].join("\n"),
  });

  test("a generated key nobody enumerated is accepted", async () => {
    const schema = await schemaWithPatterns();
    const res = validateFile(fileWith(["time_bio_and_energy: 3", "social_hours: 2"]), schema, opts);
    const unknown = res.warnings.filter((w) => w.message === "Unknown property for this entity");
    expect(unknown).toEqual([]);
  });

  test("a field outside every family still warns — patterns are not allow_extra", async () => {
    const schema = await schemaWithPatterns();
    const res = validateFile(fileWith(["totally_unknown_field: 1"]), schema, opts);
    const unknown = res.warnings.filter((w) => w.message === "Unknown property for this entity");
    expect(unknown.map((w) => w.field)).toEqual(["totally_unknown_field"]);
  });

  test("an entity without patterns is unaffected", async () => {
    const schema = await schemaWithPatterns();
    const res = validateFile(
      { path: "t.md", content: ["---", "type_key: task", "time_wgg: 3", "---", ""].join("\n") },
      schema,
      opts,
    );
    const unknown = res.warnings.filter((w) => w.message === "Unknown property for this entity");
    expect(unknown.map((w) => w.field)).toContain("time_wgg");
  });

  test("a malformed pattern fails loudly instead of matching nothing", async () => {
    const entityFiles = await readMdFiles(join(FIXTURES, "entities"));
    const propertyFiles = await readMdFiles(join(FIXTURES, "properties"));
    entityFiles.push({
      path: "broken.md",
      content: ["---", "entity_name: broken_day", "property_patterns:", '  - "^time_(["', "properties: {}", "---"].join("\n"),
    });
    expect(() => loadSchema(entityFiles, propertyFiles)).toThrow(/invalid property_patterns/);
  });
});

describe("required_unless — conditional requirement", () => {
  // `dod` is required by user ruling, but the rule arrived after history had
  // accumulated: 196 already-closed notes can never satisfy it, because writing
  // an acceptance criterion for someone else's finished work is fabrication.
  // Permanent unfixable noise teaches people to ignore the validator exactly
  // where 139 open notes genuinely need it.

  const entity = [
    "---",
    "entity_name: conditional_task",
    "properties:",
    "  status:",
    "    required: true",
    "  dod:",
    "    required_unless:",
    "      status: [Closed, Rejected]",
    "---",
  ].join("\n");

  async function schemaWith(extra: string = entity) {
    const entityFiles = await readMdFiles(join(FIXTURES, "entities"));
    const propertyFiles = await readMdFiles(join(FIXTURES, "properties"));
    entityFiles.push({ path: "conditional_task.md", content: extra });
    return loadSchema(entityFiles, propertyFiles);
  }

  const note = (fields: string[]) => ({
    path: "n.md",
    content: ["---", "type_key: conditional_task", ...fields, "---", ""].join("\n"),
  });

  const dodErrors = (res: { errors: { field: string }[] }) =>
    res.errors.filter((e) => e.field === "dod");

  test("closed note without dod is valid", async () => {
    const schema = await schemaWith();
    expect(dodErrors(validateFile(note(["status: Closed"]), schema, opts))).toEqual([]);
  });

  test("rejected note without dod is valid", async () => {
    const schema = await schemaWith();
    expect(dodErrors(validateFile(note(["status: Rejected"]), schema, opts))).toEqual([]);
  });

  test("open note without dod is INVALID — the rule still bites", async () => {
    const schema = await schemaWith();
    const res = validateFile(note(["status: Backlog"]), schema, opts);
    expect(dodErrors(res).length).toBe(1);
  });

  test("open note with dod is valid", async () => {
    const schema = await schemaWith();
    const res = validateFile(note(["status: Backlog", "dod: something checkable"]), schema, opts);
    expect(dodErrors(res)).toEqual([]);
  });

  test("a MISSING status does not exempt — absence is not a value", async () => {
    const schema = await schemaWith();
    expect(dodErrors(validateFile(note(["title: x"]), schema, opts)).length).toBe(1);
  });

  test("comparison is exact — 'closed' does not pass for 'Closed'", async () => {
    const schema = await schemaWith();
    expect(dodErrors(validateFile(note(["status: closed"]), schema, opts)).length).toBe(1);
  });

  test("plain required is untouched when no condition is declared", async () => {
    const schema = await schemaWith();
    const res = validateFile(note(["dod: x"]), schema, opts);
    expect(res.errors.filter((e) => e.field === "status").length).toBe(1);
  });

  test("an empty condition list throws instead of silently never exempting", async () => {
    const broken = [
      "---",
      "entity_name: broken_cond",
      "properties:",
      "  dod:",
      "    required_unless:",
      "      status: []",
      "---",
    ].join("\n");
    await expect(schemaWith(broken)).rejects.toThrow(/lists no values/);
  });
});

describe("inline markers honour etl.value_map", () => {
  // `fm` folds a controlled vocabulary into the declared type (mood good -> 8)
  // using the property's own etl.value_map. The validator type-checked the raw
  // word instead, so `[mood:: good]` failed as "expected number, received
  // string" on data that is correct end-to-end — and validate-hook runs on every
  // edit, so the false failure fired on every future touch of those days.

  const moodProperty = [
    "---",
    "property_name: mood",
    "property_type: number",
    "etl:",
    "  source: inline_field",
    "  marker: mood",
    "  rule: DIRECT",
    "  value_map:",
    "    good: 8",
    "    neutral: 5",
    "    bad: 3",
    "---",
  ].join("\n");

  const entity = [
    "---",
    "entity_name: mapped_day",
    "properties:",
    "  mood: {}",
    "---",
  ].join("\n");

  async function schemaWithMap() {
    const entityFiles = await readMdFiles(join(FIXTURES, "entities"));
    const propertyFiles = await readMdFiles(join(FIXTURES, "properties"));
    entityFiles.push({ path: "mapped_day.md", content: entity });
    propertyFiles.push({ path: "mood_property.md", content: moodProperty });
    return loadSchema(entityFiles, propertyFiles);
  }

  const note = (body: string) => ({
    path: "d.md",
    content: ["---", "type_key: mapped_day", "---", "", body, ""].join("\n"),
  });

  const inlineErrors = (res: { errors: { field: string }[] }) =>
    res.errors.filter((e) => e.field.startsWith("__inline__"));

  const opts2 = { typeKeyField: "type_key", checkLinks: true, vaultIndex: new Map() as never };

  test("a mapped word validates against the mapped value", async () => {
    const schema = await schemaWithMap();
    for (const word of ["good", "neutral", "bad"]) {
      const res = validateFile(note(`- [a] [mood:: ${word}]`), schema, opts2);
      expect(inlineErrors(res)).toEqual([]);
    }
  });

  test("a plain number still validates", async () => {
    const schema = await schemaWithMap();
    expect(inlineErrors(validateFile(note("- [a] [mood:: 7]"), schema, opts2))).toEqual([]);
  });

  test("an unmapped word still FAILS — the map is not an escape hatch", async () => {
    const schema = await schemaWithMap();
    const res = validateFile(note("- [a] [mood:: gooood]"), schema, opts2);
    expect(inlineErrors(res).length).toBe(1);
  });

  test("properties without a value_map are unaffected", async () => {
    const schema = await schemaWithMap();
    const res = validateFile(note("- [a] [mood:: good] [walk:: abc]"), schema, opts2);
    const fields = inlineErrors(res).map((e) => e.field);
    expect(fields).not.toContain("__inline__mood");
  });
});
