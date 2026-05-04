import { describe, test, expect } from "bun:test";
import { join } from "path";
import {
  loadSchema,
  parseProperties,
  parseEntities,
  detectTypeKeyField,
} from "../src/schema.js";
import { FIXTURES, readMdFiles } from "./helpers.js";

describe("parseProperties", () => {
  test("parses property files from fixtures", async () => {
    const files = await readMdFiles(join(FIXTURES, "properties"));
    const props = parseProperties(files);

    expect(props.length).toBe(6);

    const status = props.find((p) => p.name === "status")!;
    expect(status.property_type).toBe("enum");
    expect(status.allowed_values).toContain("In Progress");
    expect(status.validator).toBeDefined();
  });

  test("builds number validator with max_value", async () => {
    const files = await readMdFiles(join(FIXTURES, "properties"));
    const props = parseProperties(files);
    const estimate = props.find((p) => p.name === "estimate")!;

    expect(estimate.validator!.safeParse(5).success).toBe(true);
    expect(estimate.validator!.safeParse(10).success).toBe(false);
  });

  test("builds enum validator", async () => {
    const files = await readMdFiles(join(FIXTURES, "properties"));
    const props = parseProperties(files);
    const status = props.find((p) => p.name === "status")!;

    expect(status.validator!.safeParse("In Progress").success).toBe(true);
    expect(status.validator!.safeParse("Invalid").success).toBe(false);
  });

  test("builds link validator accepting single string", async () => {
    const files = await readMdFiles(join(FIXTURES, "properties"));
    const props = parseProperties(files);
    const area = props.find((p) => p.name === "area")!;

    expect(area.validator!.safeParse("[[Work]]").success).toBe(true);
    // link type is single string, not array
    expect(area.validator!.safeParse(["[[Work]]", "[[Home]]"]).success).toBe(
      false,
    );
  });
});

describe("parseEntities", () => {
  test("parses entity files with properties block", async () => {
    const files = await readMdFiles(join(FIXTURES, "entities"));
    const entities = parseEntities(files);

    expect(entities.length).toBe(3);

    const task = entities.find((e) => e.name === "task")!;
    expect(Object.keys(task.properties)).toEqual([
      "status",
      "priority",
      "estimate",
      "area",
      "tags",
    ]);
    expect(task.properties.status.required).toBe(true);
    expect(task.properties.priority.required).toBeUndefined();
  });

  test("day entity has required date", async () => {
    const files = await readMdFiles(join(FIXTURES, "entities"));
    const entities = parseEntities(files);
    const day = entities.find((e) => e.name === "day")!;

    expect(day.properties.date.required).toBe(true);
  });
});

describe("detectTypeKeyField", () => {
  test("returns 'type_key' when schema declares type_key property", () => {
    const schema = loadSchema(
      [
        {
          path: "/x/entities/task_entity.md",
          content: "---\nentity_name: task\nproperties:\n  status: {}\n---",
        },
      ],
      [
        {
          path: "/x/properties/type_key_property.md",
          content: "---\nproperty_name: type_key\nproperty_type: string\n---",
        },
      ],
    );
    expect(detectTypeKeyField(schema)).toBe("type_key");
  });

  test("returns undefined when schema has no type_key property", () => {
    const schema = loadSchema(
      [
        {
          path: "/x/entities/task_entity.md",
          content: "---\nentity_name: task\nproperties:\n  status: {}\n---",
        },
      ],
      [
        {
          path: "/x/properties/status_property.md",
          content: "---\nproperty_name: status\nproperty_type: string\n---",
        },
      ],
    );
    expect(detectTypeKeyField(schema)).toBeUndefined();
  });
});

describe("links validator accepts scalar or array", () => {
  test("single wikilink string is accepted", () => {
    const props = parseProperties([
      {
        path: "/x/properties/epic_property.md",
        content:
          "---\nproperty_name: epic\nproperty_type: links\ntarget_type_key: epic\n---",
      },
    ]);
    const epic = props.find((p) => p.name === "epic")!;
    expect(epic.validator!.safeParse("[[Some Epic]]").success).toBe(true);
    expect(epic.validator!.safeParse(["[[A]]", "[[B]]"]).success).toBe(true);
    expect(epic.validator!.safeParse(123).success).toBe(false);
  });
});

describe("loadSchema", () => {
  test("builds entityMap from entity properties block", async () => {
    const entityFiles = await readMdFiles(join(FIXTURES, "entities"));
    const propertyFiles = await readMdFiles(join(FIXTURES, "properties"));
    const schema = loadSchema(entityFiles, propertyFiles);

    const taskProps = schema.entityMap.get("task")!;
    expect(taskProps.map((p) => p.name).sort()).toEqual([
      "area",
      "estimate",
      "priority",
      "status",
      "tags",
    ]);

    // status is required for task
    const status = taskProps.find((p) => p.name === "status")!;
    expect(status.required).toBe(true);
    expect(status.property_type).toBe("enum");

    const dayProps = schema.entityMap.get("day")!;
    expect(dayProps.map((p) => p.name)).toEqual(["date"]);
    expect(dayProps[0].required).toBe(true);

    const bookProps = schema.entityMap.get("book")!;
    expect(bookProps.map((p) => p.name).sort()).toEqual(["status", "tags"]);
    const bookStatus = bookProps.find((p) => p.name === "status")!;
    expect(bookStatus.required).toBe(false);
  });
});
