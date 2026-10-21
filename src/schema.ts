import { parseFrontmatter } from "./frontmatter.js";
import { z, type ZodTypeAny } from "zod";
import { asList, asRecord } from "./values.js";
import type {
  RawFile,
  PropertySchema,
  LinkConstraints,
  EntitySchema,
  EntityPropertyConfig,
  ResolvedProperty,
  VaultSchema,
} from "./types.js";

/** Type field used when neither the caller nor the schema names one. */
export const DEFAULT_TYPE_KEY_FIELD = "entity";

/** True for an entity or property definition note (they are schema, not notes to validate). */
export function isSchemaDefinition(data: Record<string, unknown>): boolean {
  return Boolean(data.entity_name || data.property_name);
}

/** Folder of a schema file relative to its base directory ("properties" or "entities").
 * Returns undefined if the file is directly in the base dir or the base dir isn't in the path. */
function folderFromPath(path: string, baseDir: string): string | undefined {
  const parts = path.split("/");
  parts.pop(); // remove filename
  const idx = parts.lastIndexOf(baseDir);
  return idx >= 0 && idx < parts.length - 1 ? parts.slice(idx + 1).join("/") : undefined;
}

/** Parse property files' frontmatter into PropertySchema[] */
export function parseProperties(files: RawFile[]): PropertySchema[] {
  const results: PropertySchema[] = [];

  for (const file of files) {
    const { data } = parseFrontmatter(file.content);
    if (!data.property_name) continue;

    const prop: PropertySchema = {
      name: String(data.property_name),
      property_type: data.property_type ?? "string",
      allowed_values: data.allowed_values != null ? (asList(data.allowed_values) as (string | number)[]) : undefined,
      min_value: data.min_value ?? undefined,
      max_value: data.max_value ?? undefined,
      unit: data.unit ?? undefined,
      nullable: data.nullable ?? undefined,
      link_constraints: parseLinkConstraints(data),
      custom_validator: data.custom_validator ?? undefined,
      value_map: parseValueMap(data.etl),
      folder: folderFromPath(file.path, "properties"),
      sourcePath: file.path,
    };

    prop.validator = buildPropertyValidator(prop);
    if (prop.custom_validator) prop.customCheck = compileCustomValidator(prop.custom_validator);
    results.push(prop);
  }

  return results;
}

/** The `target_*` keys of a property note, or undefined when it sets none. */
function parseLinkConstraints(data: Record<string, unknown>): LinkConstraints | undefined {
  const { target_type_key, target_folder, target_has_property, target_property_value } = data as LinkConstraints;
  if (!target_type_key && !target_folder && !target_has_property && !target_property_value) return undefined;
  return {
    target_type_key: target_type_key ?? undefined,
    target_folder: target_folder ?? undefined,
    target_has_property: target_has_property ?? undefined,
    target_property_value: target_property_value ?? undefined,
  };
}

/** `etl.value_map` of a property note, when it is a mapping. */
function parseValueMap(etl: unknown): Record<string, unknown> | undefined {
  const map = asRecord(etl).value_map;
  return map && typeof map === "object" && !Array.isArray(map) ? (map as Record<string, unknown>) : undefined;
}

/** Parse entity files' frontmatter into EntitySchema[] */
export function parseEntities(files: RawFile[]): EntitySchema[] {
  const results: EntitySchema[] = [];

  for (const file of files) {
    const { data } = parseFrontmatter(file.content);
    if (!data.entity_name) continue;

    // `properties` maps a name to its config ({ required: true }); a bare name means {}.
    const properties: Record<string, EntityPropertyConfig> = {};
    for (const [propName, config] of Object.entries(data.properties ?? {})) {
      properties[propName] = config && typeof config === "object" ? (config as EntityPropertyConfig) : {};
    }

    results.push({
      name: String(data.entity_name),
      properties,
      extends: data.extends ?? undefined,
      allow_extra: data.allow_extra ?? undefined,
      property_patterns: Array.isArray(data.property_patterns)
        ? data.property_patterns.map(String)
        : undefined,
      expected_folder: data.expected_folder ?? undefined,
      folder: folderFromPath(file.path, "entities"),
      sourcePath: file.path,
    });
  }

  return results;
}

type InheritedProps = {
  properties: Record<string, EntityPropertyConfig>;
  /** property name → entity name it was inherited from */
  origins: Map<string, string>;
};

/** Resolve inheritance chains for all entities */
function resolveInheritance(
  entities: EntitySchema[],
): Map<string, InheritedProps> {
  const byName = new Map(entities.map((e) => [e.name, e]));
  const resolved = new Map<string, InheritedProps>();

  function resolve(name: string, visiting: Set<string>): InheritedProps {
    if (resolved.has(name)) return resolved.get(name)!;
    if (visiting.has(name)) {
      throw new Error(`Circular entity inheritance: ${[...visiting, name].join(" → ")}`);
    }
    visiting.add(name);

    const entity = byName.get(name);
    if (!entity) return { properties: {}, origins: new Map() };

    let merged: Record<string, EntityPropertyConfig> = {};
    let origins = new Map<string, string>();

    // Resolve parent first
    if (entity.extends) {
      const parent = resolve(entity.extends, visiting);
      merged = { ...parent.properties };
      origins = new Map(parent.origins);
      // Properties from parent that don't have an origin yet → came from parent
      for (const key of Object.keys(parent.properties)) {
        if (!origins.has(key)) origins.set(key, entity.extends);
      }
    }

    // Own properties override parent (child's config wins)
    for (const [key, config] of Object.entries(entity.properties)) {
      merged[key] = config;
      origins.delete(key); // own property — not inherited
    }

    const result = { properties: merged, origins };
    resolved.set(name, result);
    return result;
  }

  for (const entity of entities) {
    resolve(entity.name, new Set());
  }
  return resolved;
}

/** `type_key` when the schema declares a property of that name, else undefined. */
export function detectTypeKeyField(schema: VaultSchema): string | undefined {
  return schema.properties.some((p) => p.name === "type_key") ? "type_key" : undefined;
}

/** The type field to use: an explicit setting, else the one the schema
 * declares, else DEFAULT_TYPE_KEY_FIELD. Shared by the CLI and the plugin. */
export function resolveTypeKeyField(schema: VaultSchema, explicit?: string): string {
  return explicit?.trim() || detectTypeKeyField(schema) || DEFAULT_TYPE_KEY_FIELD;
}

/** Build complete VaultSchema from raw file contents */
export function loadSchema(
  entityFiles: RawFile[],
  propertyFiles: RawFile[],
): VaultSchema {
  const entities = parseEntities(entityFiles);
  const properties = parseProperties(propertyFiles);

  const propByName = new Map(properties.map((p) => [p.name, p]));
  const inheritance = resolveInheritance(entities);

  const entityByName = new Map(entities.map((e) => [e.name, e]));
  const entityMap = new Map<string, ResolvedProperty[]>();
  const allowExtraMap = new Map<string, boolean>();
  const propertyPatternMap = new Map<string, RegExp[]>();
  const expectedFolderMap = new Map<string, string>();
  for (const entity of entities) {
    const { properties: merged, origins } = inheritance.get(entity.name)!;
    const resolved: ResolvedProperty[] = Object.entries(merged).map(([propName, config]) => ({
      ...(propByName.get(propName) ?? { name: propName, property_type: "unknown" }),
      // required_unless implies required, unless `required: false` says otherwise.
      required: config.required ?? config.required_unless != null,
      required_unless: normalizeRequiredUnless(propName, config.required_unless),
      inheritedFrom: origins.get(propName),
    }));

    entityMap.set(entity.name, resolved);
    allowExtraMap.set(entity.name, entity.allow_extra ?? false);
    propertyPatternMap.set(entity.name, compilePatterns(entity, entityByName));
    if (entity.expected_folder) expectedFolderMap.set(entity.name, entity.expected_folder);
  }

  return {
    entities,
    properties,
    entityMap,
    allowExtraMap,
    propertyPatternMap,
    expectedFolderMap,
  };
}

/** Build a Zod validator for a single property based on its schema */
function buildPropertyValidator(prop: PropertySchema): ZodTypeAny {
  switch (prop.property_type) {
    case "string":
    case "link":
    case "date":
    case "datetime":
    case "time":
      // Dates and times are free text: YAML dates arrive as text (values.ts coerceValue).
      return z.string();

    case "number": {
      let schema = z.number();
      if (prop.min_value != null) schema = schema.min(prop.min_value);
      if (prop.max_value != null) schema = schema.max(prop.max_value);
      return schema;
    }

    case "boolean":
      return z.boolean();

    case "enum": {
      if (prop.allowed_values && prop.allowed_values.length > 0) {
        // Values compare as text; numbers arrive as text (values.ts coerceValue).
        const [first, ...rest] = prop.allowed_values.map(String);
        return z.enum([first, ...rest]);
      }
      return z.string();
    }

    case "links":
      return z.union([z.string(), z.array(z.string())]);

    case "list":
      // A scalar counts as a one-item list (`assignee: "[[X]]"` is as legal
      // as the block form), like "links" above. A mapping still fails.
      return z.union([z.array(z.unknown()), z.string(), z.number(), z.boolean()]);

    case "emoji":
      return z.string().emoji();

    default:
      // "any" (a shape that varies by note, chosen by the schema author) and
      // unknown types are not checked.
      return z.unknown();
  }
}

/** Compile a property's `custom_validator` expression once. The expression
 * sees `value` and returns true to pass, false or a message to fail. It is
 * code from the vault's own schema and runs unsandboxed. A syntax error is
 * reported each time the check runs. */
function compileCustomValidator(expression: string): (value: unknown) => unknown {
  try {
    // eslint-disable-next-line no-new-func
    return new Function("value", `return (${expression})`) as (value: unknown) => unknown;
  } catch (e) {
    return () => {
      throw e;
    };
  }
}

/** Compile an entity's `property_patterns`, walking `extends` so a child
 * inherits its parent's families. A malformed regex throws: skipping it would
 * leave the schema looking configured while it matches nothing. */
function compilePatterns(
  entity: EntitySchema,
  byName: Map<string, EntitySchema>,
): RegExp[] {
  const out: RegExp[] = [];
  const seen = new Set<string>();
  let current: EntitySchema | undefined = entity;

  while (current) {
    for (const raw of current.property_patterns ?? []) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      try {
        out.push(new RegExp(raw));
      } catch (err) {
        throw new Error(
          `Entity "${current.name}": invalid property_patterns entry ${JSON.stringify(raw)} — ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    current = current.extends ? byName.get(current.extends) : undefined;
  }

  return out;
}

/** Validate and normalize a `required_unless` block. A malformed block
 * throws: silently dropping it would make the field unconditionally required. */
function normalizeRequiredUnless(
  propName: string,
  raw: unknown,
): Record<string, string[]> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `Property "${propName}": required_unless must be a map of field → list of values`,
    );
  }

  const out: Record<string, string[]> = {};
  for (const [field, values] of Object.entries(raw as Record<string, unknown>)) {
    const list = asList(values);
    if (list.length === 0) {
      throw new Error(
        `Property "${propName}": required_unless.${field} lists no values — ` +
          `an empty condition can never exempt anything, so the field would stay ` +
          `unconditionally required while appearing conditional`,
      );
    }
    out[field] = list.map(String);
  }
  return Object.keys(out).length ? out : undefined;
}
