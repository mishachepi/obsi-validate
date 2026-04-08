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

/** Parse property files' frontmatter into PropertySchema[] */
export function parseProperties(files: RawFile[]): PropertySchema[] {
  const results: PropertySchema[] = [];

  for (const file of files) {
    const { data } = matter(file.content);
    if (!data.property_type && data.type_key !== "property") continue;

    const name =
      data.name ??
      file.path.split("/").pop()?.replace("_property.md", "").replace(".md", "") ??
      "";

    // Derive folder from path (relative to properties dir)
    const pathParts = file.path.split("/");
    pathParts.pop(); // remove filename
    // Find "properties" in path and take everything after it
    const propIdx = pathParts.lastIndexOf("properties");
    const folder = propIdx >= 0 && propIdx < pathParts.length - 1
      ? pathParts.slice(propIdx + 1).join("/")
      : undefined;

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
      link_constraints: linkConstraints,
      custom_validator: data.custom_validator ?? undefined,
      folder,
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
    if (data.component_type !== "entity") continue;

    const name =
      data.name ??
      file.path.split("/").pop()?.replace("_entity.md", "").replace(".md", "") ??
      "";

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
      allow_extra: data.allow_extra ?? undefined,
    });
  }

  return results;
}

/** Build complete VaultSchema from raw file contents */
export function loadSchema(
  entityFiles: RawFile[],
  propertyFiles: RawFile[],
): VaultSchema {
  const entities = parseEntities(entityFiles);
  const properties = parseProperties(propertyFiles);

  const propByName = new Map(properties.map((p) => [p.name, p]));

  // Build entity → resolved properties from entity's properties block
  const entityMap = new Map<string, ResolvedProperty[]>();
  const allowExtraMap = new Map<string, boolean>();

  for (const entity of entities) {
    const resolved: ResolvedProperty[] = [];

    for (const [propName, config] of Object.entries(entity.properties)) {
      const propSchema = propByName.get(propName);

      if (propSchema) {
        resolved.push({
          ...propSchema,
          required: config.required ?? false,
        });
      } else {
        // Property declared in entity but no property file exists
        // → known field, but no type validation (just presence check for required)
        resolved.push({
          name: propName,
          property_type: "unknown",
          required: config.required ?? false,
        });
      }
    }

    entityMap.set(entity.name, resolved);
    allowExtraMap.set(entity.name, entity.allow_extra ?? false);
  }

  return { entities, properties, entityMap, allowExtraMap };
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
    case "wikilink":
      return z.union([z.string(), z.array(z.string())]);

    case "list":
      return z.array(z.unknown());

    case "emoji":
      return z.string();

    default:
      return z.unknown();
  }
}

function toArray(val: unknown): (string | number)[] {
  if (Array.isArray(val)) return val;
  if (val != null) return [val as string | number];
  return [];
}
