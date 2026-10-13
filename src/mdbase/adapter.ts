/**
 * mdbase as the shape engine for validateFile().
 *
 * Types are generated in memory by translate.ts and checked with mdbase's
 * JSON-Schema validator (no Collection, no disk). The engine sees frontmatter
 * already normalized by validateFile() (empty = not set, values coerced), and
 * its diagnostics are reworded with the same messages as the Zod engine. The
 * CLI uses this engine by default; the plugin uses Zod.
 */
import type { TypeDefinition } from "@callumalpass/mdbase";
import { validateJsonSchemaFrontmatter } from "./json-schema.js";
import type { ShapeEngine, ValidationError, VaultSchema } from "../types.js";
import { translateSchema } from "./translate.js";
import { REQUIRED_MESSAGE, unknownPropertyMessage, valueError } from "../values.js";

export function mdbaseShapeEngine(schema: VaultSchema, typeKeyField: string): ShapeEngine {
  const types = new Map(
    translateSchema(schema, typeKeyField).types.map((t) => [t.name, t as unknown as TypeDefinition]),
  );

  return (data, entityType) => {
    const def = types.get(entityType);
    if (!def) return { errors: [], warnings: [] }; // unknown type is reported before the engine runs

    const propByName = new Map((schema.entityMap.get(entityType) ?? []).map((p) => [p.name, p]));
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const reported = new Set<string>();
    for (const d of validateJsonSchemaFrontmatter(data, def)) {
      // `tags[0]` / `tags.0` → `tags`: one message per field.
      const field = (d.field ?? "").split(/[.[]/)[0];
      if (d.code === "schema_if" || reported.has(`${d.code === "schema_required"}:${field}`)) continue;
      reported.add(`${d.code === "schema_required"}:${field}`);
      if (d.code === "schema_additional_properties") {
        warnings.push({ field, message: unknownPropertyMessage(entityType) });
      } else if (d.code === "schema_required") {
        errors.push({ field, message: REQUIRED_MESSAGE });
      } else {
        const prop = propByName.get(field);
        const message = prop ? valueError(prop, data[field]) : d.message;
        errors.push({ field, message, expected: prop?.property_type, received: data[field] });
      }
    }
    return { errors, warnings };
  };
}
