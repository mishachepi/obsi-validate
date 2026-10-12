/**
 * VaultSchema → mdbase (JSON Schema 2020-12) projection.
 *
 * The two-tier schema notes (entities/** + properties/**) stay the source of
 * truth; this module compiles them into mdbase's flat per-type files, so
 * `_types/*.md` and `mdbase.yaml` are generated, never edited by hand.
 *
 * One mapping table, no hooks, no per-property overrides. Whatever mdbase cannot
 * express (link target folder/property checks, task-intake gating,
 * custom_validator, expected_folder, body link checks) is simply not emitted
 * and stays in the bespoke layer of validate.ts.
 */
import matter from "gray-matter";
import type { ResolvedProperty, VaultSchema } from "../types.js";

export type JsonSchema = Record<string, unknown>;

export type MdbaseLinkRule = { target_type?: string | string[]; validate_exists?: boolean };

/** Shape of one `_types/<name>.md` frontmatter (subset of mdbase TypeDefinition). */
export type MdbaseTypeDef = {
  kind: "mdbase.type";
  name: string;
  version: 1;
  schema: { dialect: "json-schema-2020-12"; value: JsonSchema };
  collection?: { links: Record<string, MdbaseLinkRule> };
};

/** Shape of the generated `mdbase.yaml`. */
export type MdbaseConfigFile = {
  spec_version: "0.3.0";
  name: string;
  settings: {
    types_folder: "_types";
    validation: "error";
    explicit_type_keys: string[];
    include_subfolders: true;
  };
};

/** Same pattern as Zod's `.emoji()`: one or more emoji characters. */
const EMOJI_PATTERN = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";

// Fresh object per call: a shared array reference would make the YAML emitter
// write anchors/aliases (`&ref_0` / `*ref_0`) across properties.
const listTolerant = (): JsonSchema => ({ type: ["array", "string", "number", "boolean"] });

/** property_type → JSON Schema fragment. Mirrors buildPropertyValidator() in schema.ts. */
export function propertyToJsonSchema(prop: ResolvedProperty): JsonSchema {
  let out: JsonSchema;
  switch (prop.property_type) {
    case "string":
    case "time":
    case "date":
    case "datetime":
    case "link":
      out = { type: "string" };
      break;
    case "emoji":
      out = { type: "string", pattern: EMOJI_PATTERN };
      break;
    case "number": {
      out = { type: "number" };
      if (prop.min_value != null) out.minimum = prop.min_value;
      if (prop.max_value != null) out.maximum = prop.max_value;
      break;
    }
    case "boolean":
      out = { type: "boolean" };
      break;
    case "enum": {
      const vals = prop.allowed_values ?? [];
      if (vals.length === 0) {
        out = { type: "string" };
        break;
      }
      // Zod side coerces numeric values to strings before matching, so a numeric
      // enum member is legal in both spellings (`priority: 1` and `priority: "1"`).
      out = { enum: [...new Set([...vals, ...vals.map(String)])] };
      break;
    }
    case "links":
      out = { type: ["string", "array"], items: { type: "string" } };
      break;
    case "list":
      out = listTolerant();
      break;
    default:
      // any / object / map / array / wikilink / marker / unknown — the Zod side
      // has no case for these and falls through to z.unknown(); mirror that
      // exactly rather than "improving" it here (parity first).
      out = {};
  }

  if (prop.nullable && Object.keys(out).length > 0) {
    if (Array.isArray(out.enum)) out.enum = [...(out.enum as unknown[]), null];
    else if (out.type !== undefined) {
      const t = Array.isArray(out.type) ? (out.type as string[]) : [out.type as string];
      out.type = [...t, "null"];
    }
  }
  return out;
}

/** Each value, plus its number form when it is numeric text. */
function withNumericSpellings(values: string[]): (string | number)[] {
  const numbers = values.filter((v) => v.trim() !== "" && Number.isFinite(Number(v))).map(Number);
  return [...values, ...numbers];
}

/** Build the `if/else` clause expressing `required_unless` for one property.
 * Exempt when ANY listed field holds ANY of its values (schema.ts semantics);
 * the field must be present for the exemption to apply. */
function requiredUnlessClause(propName: string, cond: Record<string, string[]>): JsonSchema {
  const branches = Object.entries(cond).map(([field, values]) => ({
    // Numbers compare by their string form on the Zod side, so `1` matches "1".
    properties: { [field]: { enum: withNumericSpellings(values) } },
    required: [field],
  }));
  return {
    if: branches.length === 1 ? branches[0] : { anyOf: branches },
    then: {},
    else: { required: [propName] },
  };
}

/** One entity (already inheritance-resolved in VaultSchema) → mdbase type definition. */
export function entityToTypeDef(
  schema: VaultSchema,
  entityName: string,
  typeKeyField: string,
): MdbaseTypeDef {
  const props = schema.entityMap.get(entityName);
  if (!props) throw new Error(`Unknown entity "${entityName}"`);

  const properties: Record<string, JsonSchema> = { [typeKeyField]: { const: entityName } };
  const required: string[] = [typeKeyField];
  const conditionals: JsonSchema[] = [];
  const links: Record<string, MdbaseLinkRule> = {};

  for (const p of [...props].sort((a, b) => a.name.localeCompare(b.name))) {
    if (p.name === typeKeyField) continue;
    properties[p.name] = propertyToJsonSchema(p);
    if (p.required && p.required_unless) conditionals.push(requiredUnlessClause(p.name, p.required_unless));
    else if (p.required) required.push(p.name);
    const target = p.link_constraints?.target_type_key;
    if (target) links[p.name] = { target_type: target, validate_exists: true };
  }

  const value: JsonSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required,
    properties,
  };
  const patterns = schema.propertyPatternMap.get(entityName) ?? [];
  if (patterns.length) {
    value.patternProperties = Object.fromEntries(patterns.map((re) => [re.source, {}]));
  }
  value.additionalProperties = schema.allowExtraMap.get(entityName) ?? false;
  if (conditionals.length) value.allOf = conditionals;

  const def: MdbaseTypeDef = {
    kind: "mdbase.type",
    name: entityName,
    version: 1,
    schema: { dialect: "json-schema-2020-12", value },
  };
  if (Object.keys(links).length) def.collection = { links };
  return def;
}

/** Whole schema → config + one type per entity, deterministic order. */
export function translateSchema(
  schema: VaultSchema,
  typeKeyField: string,
  collectionName = "obsi-validate",
): { config: MdbaseConfigFile; types: MdbaseTypeDef[] } {
  const names = [...schema.entityMap.keys()].sort();
  return {
    config: {
      spec_version: "0.3.0",
      name: collectionName,
      settings: {
        types_folder: "_types",
        validation: "error",
        explicit_type_keys: [typeKeyField],
        include_subfolders: true,
      },
    },
    types: names.map((n) => entityToTypeDef(schema, n, typeKeyField)),
  };
}

/** Render one type definition as a `_types/<name>.md` document. */
export function renderTypeFile(def: MdbaseTypeDef): string {
  return matter.stringify(`# ${def.name}\n\nGenerated by \`obsi-validate mdbase-export\` — do not edit; edit the entity/property notes.\n`, def);
}

/** Render `mdbase.yaml`. */
export function renderConfigFile(config: MdbaseConfigFile): string {
  // gray-matter's stringify wraps YAML in `---` fences; strip them to get a bare YAML doc.
  return matter.stringify("", config).replace(/^---\n/, "").replace(/\n---\n*$/, "\n");
}
