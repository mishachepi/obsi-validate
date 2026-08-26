import matter from "gray-matter";
import { z, type ZodTypeAny } from "zod";
import type {
  RawFile,
  PropertySchema,
  LinkConstraints,
  EntitySchema,
  EntityPropertyConfig,
  ResolvedProperty,
  VaultSchema,
} from "./types.js";

/** Derive a name from a schema file path: filename minus the suffix and ".md" */
function nameFromPath(path: string, suffix: string): string {
  return path.split("/").pop()?.replace(suffix, "").replace(".md", "") ?? "";
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
    const { data } = matter(file.content);
    if (!data.property_name && !data.property_type) continue;

    const name = data.property_name ?? data.name ?? nameFromPath(file.path, "_property.md");
    const folder = folderFromPath(file.path, "properties");

    // Parse link constraints
    let linkConstraints: LinkConstraints | undefined;
    if (data.target_type_key || data.target_folder || data.target_has_property || data.target_property_value) {
      linkConstraints = {
        target_type_key: data.target_type_key ?? undefined,
        target_folder: data.target_folder ?? undefined,
        target_has_property: data.target_has_property ?? undefined,
        target_property_value: data.target_property_value ?? undefined,
      };
    }

    const prop: PropertySchema = {
      name,
      property_type: data.property_type ?? "string",
      allowed_values: data.allowed_values
        ? toArray(data.allowed_values)
        : undefined,
      min_value: data.min_value ?? undefined,
      max_value: data.max_value ?? undefined,
      unit: data.unit ?? undefined,
      nullable: data.nullable ?? undefined,
      link_constraints: linkConstraints,
      custom_validator: data.custom_validator ?? undefined,
      value_map:
        data.etl && typeof data.etl === "object" && !Array.isArray(data.etl) &&
        (data.etl as Record<string, unknown>).value_map &&
        typeof (data.etl as Record<string, unknown>).value_map === "object"
          ? ((data.etl as Record<string, unknown>).value_map as Record<string, unknown>)
          : undefined,
      folder,
      sourcePath: file.path,
    };

    prop.validator = buildPropertyValidator(prop);
    results.push(prop);
  }

  return results;
}

/** Parse entity files' frontmatter into EntitySchema[] */
export function parseEntities(files: RawFile[]): EntitySchema[] {
  const results: EntitySchema[] = [];

  for (const file of files) {
    const { data } = matter(file.content);
    if (!data.entity_name && !data.properties) continue;

    const name = data.entity_name ?? data.name ?? nameFromPath(file.path, "_entity.md");
    const folder = folderFromPath(file.path, "entities");

    // Parse properties block: { propName: { required: true } } or { propName: {} }
    const rawProps = data.properties ?? {};
    const properties: Record<string, EntityPropertyConfig> = {};

    for (const [propName, config] of Object.entries(rawProps)) {
      if (config && typeof config === "object") {
        properties[propName] = config as EntityPropertyConfig;
      } else {
        properties[propName] = {};
      }
    }

    results.push({
      name,
      properties,
      extends: data.extends ?? undefined,
      allow_extra: data.allow_extra ?? undefined,
      property_patterns: Array.isArray(data.property_patterns)
        ? data.property_patterns.map(String)
        : undefined,
      expected_folder: data.expected_folder ?? undefined,
      folder,
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

/** Auto-detect the frontmatter field used to discriminate entity types.
 *
 * The vault's own schema reveals the convention: if a property named `type_key`
 * is declared, instances use `type_key:`. Otherwise fall back to the legacy
 * `entity` default. Returns undefined when caller wants no auto-detection.
 */
export function detectTypeKeyField(schema: VaultSchema): string | undefined {
  if (schema.properties.some((p) => p.name === "type_key")) return "type_key";
  return undefined;
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

  // Build entity → resolved properties (with inheritance)
  const entityMap = new Map<string, ResolvedProperty[]>();
  const allowExtraMap = new Map<string, boolean>();

  const propertyPatternMap = new Map<string, RegExp[]>();
  const entityByName = new Map(entities.map((e) => [e.name, e]));
  for (const entity of entities) {
    const inherited = inheritance.get(entity.name);
    const mergedProps = inherited?.properties ?? entity.properties;
    const origins = inherited?.origins ?? new Map<string, string>();
    const resolved: ResolvedProperty[] = [];

    for (const [propName, config] of Object.entries(mergedProps)) {
      const propSchema = propByName.get(propName);
      const inheritedFrom = origins.get(propName);

      if (propSchema) {
        resolved.push({
          ...propSchema,
          required: config.required ?? config.required_unless !== undefined,
          required_unless: normaliseRequiredUnless(propName, config.required_unless),
          inheritedFrom,
        });
      } else {
        resolved.push({
          name: propName,
          property_type: "unknown",
          required: config.required ?? config.required_unless !== undefined,
          required_unless: normaliseRequiredUnless(propName, config.required_unless),
          inheritedFrom,
        });
      }
    }

    entityMap.set(entity.name, resolved);
    allowExtraMap.set(entity.name, entity.allow_extra ?? false);
    propertyPatternMap.set(entity.name, compilePatterns(entity, entityByName));
  }

  const expectedFolderMap = new Map<string, string>();
  for (const entity of entities) {
    if (entity.expected_folder) {
      expectedFolderMap.set(entity.name, entity.expected_folder);
    }
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
      return z.string();

    case "number": {
      let schema = z.number();
      if (prop.min_value != null) schema = schema.min(prop.min_value);
      if (prop.max_value != null) schema = schema.max(prop.max_value);
      return schema;
    }

    case "boolean":
      return z.boolean();

    case "date":
      // gray-matter may coerce YYYY-MM-DD to Date objects
      return z.union([z.string(), z.date()]);

    case "time":
      return z.string();

    case "datetime":
      return z.union([z.string(), z.date()]);

    case "enum": {
      if (prop.allowed_values && prop.allowed_values.length > 0) {
        const vals = prop.allowed_values.map(String);
        const [first, ...rest] = vals;
        return z.preprocess(
          (v) => (typeof v === "number" ? String(v) : v),
          z.enum([first, ...rest]),
        );
      }
      return z.string();
    }

    case "link":
      return z.string();

    case "links":
      return z.union([z.string(), z.array(z.string())]);

    case "list":
      // Scalar tolerance (user ruling 18.08): both YAML representations of a
      // one-element list are legal — `assignee: "[[X]]"` and the block form.
      // Half the vault is written by hand or by tools that emit the scalar
      // form; rejecting it ("Expected array, received string") punished a
      // legal document. A scalar is treated as a one-item list, mirroring
      // "links" above and the link_constraints walker in validate.ts, which
      // already coerce scalar↔array. Genuinely broken shapes (a YAML mapping
      // where a list belongs) still fail.
      return z.union(
        [z.array(z.unknown()), z.string(), z.number(), z.boolean()],
        {
          errorMap: () => ({
            message:
              "Expected a list or a single scalar value (mappings and empty values are not lists)",
          }),
        },
      );

    case "emoji":
      return z.string().emoji({ message: "Must be an emoji" });

    case "any":
      // Explicit escape hatch (user ruling 26.08): a property whose legal
      // shape genuinely varies by record (e.g. `dod` — string prose most of
      // the time, occasionally a YAML list) opts out of shape-checking
      // entirely. Distinct from `default` below: this is deliberate, named,
      // and documented — the default branch exists for schema authors who
      // typo'd or forgot a type, and must stay silently permissive for
      // backward compat, but should never be the thing `any` relies on.
      return z.unknown();

    default:
      return z.unknown();
  }
}

function toArray(val: unknown): (string | number)[] {
  if (Array.isArray(val)) return val;
  if (val != null) return [val as string | number];
  return [];
}


/**
 * Compile an entity's `property_patterns`, walking `extends` so a child inherits
 * its parent's families.
 *
 * A malformed regex THROWS rather than being skipped. A pattern that silently
 * compiles to nothing would leave the schema looking configured while every
 * field it was meant to cover kept warning — the failure mode this whole task
 * exists to remove, reintroduced one level up.
 */
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


/**
 * Validate and normalise a `required_unless` block.
 *
 * Throws on a malformed shape rather than ignoring it. A condition silently
 * dropped would make the field unconditionally required again — the schema would
 * look like it carried the exemption while every legacy note kept failing, which
 * is the noise this feature exists to remove.
 */
function normaliseRequiredUnless(
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
    const list = Array.isArray(values) ? values : [values];
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
