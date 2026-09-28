/**
 * mdbase as the shape engine for validateFile().
 *
 * Types are produced in memory by translate.ts and fed to mdbase's pure
 * `validateJsonSchemaFrontmatter()` — no Collection, no disk, no sql.js —
 * so the same engine can serve the CLI and, later, the plugin.
 * Diagnostics are mapped onto the existing ValidationError contract; all
 * bespoke rules stay in validate.ts untouched.
 */
import { validateJsonSchemaFrontmatter, type TypeDefinition } from "@callumalpass/mdbase";
import type { ShapeEngine, ValidationError, VaultSchema } from "../types.js";
import { translateSchema } from "./translate.js";

export function mdbaseShapeEngine(schema: VaultSchema, typeKeyField: string): ShapeEngine {
  const types = new Map(
    translateSchema(schema, typeKeyField).types.map((t) => [t.name, t as unknown as TypeDefinition]),
  );

  return (data, entityType) => {
    const def = types.get(entityType);
    if (!def) return { errors: [], warnings: [] }; // unknown type is reported before the engine runs

    const props = schema.entityMap.get(entityType) ?? [];
    const propType = new Map(props.map((p) => [p.name, p.property_type]));
    const nullable = new Set(props.filter((p) => p.nullable).map((p) => p.name));
    const dateTyped = new Set(props.filter((p) => p.property_type === "date" || p.property_type === "datetime").map((p) => p.name));

    // Same tolerances the Zod path applies before type-checking:
    //  - nullable + empty → passes as null (the key stays present, so a
    //    `required` / `required_unless` check still sees it, exactly like Zod's
    //    `prop.name in data`);
    //  - gray-matter turns bare ISO dates into Date objects. Zod accepts a Date
    //    only for date/datetime properties (z.union([string, date])); JSON Schema
    //    has no Date, so for those properties hand mdbase the ISO string. A Date
    //    landing in a `string` property stays a Date and fails on both engines.
    const frontmatter: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (nullable.has(k) && (v === null || v === undefined || v === "")) frontmatter[k] = null;
      else frontmatter[k] = v instanceof Date && dateTyped.has(k) ? v.toISOString() : v;
    }

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    for (const d of validateJsonSchemaFrontmatter(frontmatter, def)) {
      const field = d.field ?? "";
      switch (d.code) {
        case "schema_additional_properties":
          warnings.push({ field, message: "Unknown property for this entity" });
          break;
        case "schema_required":
          errors.push({ field, message: "Required field is missing" });
          break;
        case "schema_if":
          // Root-level companion of an `else`-branch failure; the field-level
          // schema_required above already carries the information.
          break;
        default:
          errors.push({ field, message: d.message, expected: propType.get(field), received: data[field] });
      }
    }
    return { errors, warnings };
  };
}
