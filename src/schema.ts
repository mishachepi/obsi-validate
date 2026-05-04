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
          required: config.required ?? false,
          inheritedFrom,
        });
      } else {
        resolved.push({
          name: propName,
          property_type: "unknown",
          required: config.required ?? false,
          inheritedFrom,
        });
      }
    }

    entityMap.set(entity.name, resolved);
    allowExtraMap.set(entity.name, entity.allow_extra ?? false);
  }

  const expectedFolderMap = new Map<string, string>();
  for (const entity of entities) {
    if (entity.expected_folder) {
      expectedFolderMap.set(entity.name, entity.expected_folder);
    }
  }

  return { entities, properties, entityMap, allowExtraMap, expectedFolderMap };
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
      return z.array(z.unknown());

    case "emoji":
      return z.string().emoji({ message: "Must be an emoji" });

    default:
      return z.unknown();
  }
}

function toArray(val: unknown): (string | number)[] {
  if (Array.isArray(val)) return val;
  if (val != null) return [val as string | number];
  return [];
}
