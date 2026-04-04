import matter from "gray-matter";
import type {
  RawFile,
  VaultSchema,
  ValidationResult,
  ValidationSummary,
  ValidationError,
} from "./types.js";

/** Validate a single file's frontmatter against the vault schema */
export function validateFile(
  file: RawFile,
  schema: VaultSchema,
): ValidationResult {
  let data: Record<string, unknown>;
  try {
    data = matter(file.content).data;
  } catch (e) {
    return {
      file: file.path,
      entityType: null,
      valid: false,
      errors: [
        {
          field: "_yaml",
          message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      warnings: [],
    };
  }
  const entityType = data.type_key as string | undefined;

  if (!entityType) {
    return {
      file: file.path,
      entityType: null,
      valid: true,
      errors: [],
      warnings: [{ field: "type_key", message: "Missing type_key, skipped" }],
    };
  }

  const resolvedProps = schema.entityMap.get(entityType);
  if (!resolvedProps) {
    return {
      file: file.path,
      entityType,
      valid: true,
      errors: [],
      warnings: [
        { field: "type_key", message: `Unknown entity type: ${entityType}` },
      ],
    };
  }

  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const propByName = new Map(resolvedProps.map((p) => [p.name, p]));
  const allowExtra = schema.allowExtraMap.get(entityType) ?? false;

  // Check each frontmatter field
  for (const [field, value] of Object.entries(data)) {
    if (field === "type_key") continue;

    const prop = propByName.get(field);

    if (!prop) {
      if (!allowExtra) {
        warnings.push({ field, message: "Unknown property for this entity" });
      }
      continue;
    }

    // No property file → no validator → skip value validation (field is still recognized)
    if (!prop.validator) continue;

    const result = prop.validator.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          field,
          message: issue.message,
          expected: prop.property_type,
          received: value,
        });
      }
    }
  }

  // Check required fields
  for (const prop of resolvedProps) {
    if (prop.required && !(prop.name in data)) {
      errors.push({
        field: prop.name,
        message: "Required field is missing",
      });
    }
  }

  return {
    file: file.path,
    entityType,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Validate multiple files, return summary */
export function validateFiles(
  files: RawFile[],
  schema: VaultSchema,
): ValidationSummary {
  const results: ValidationResult[] = [];
  let valid = 0;
  let invalid = 0;
  let skipped = 0;

  for (const file of files) {
    const result = validateFile(file, schema);
    results.push(result);

    if (result.entityType === null && result.valid) {
      skipped++;
    } else if (result.valid) {
      valid++;
    } else {
      invalid++;
    }
  }

  return {
    total: files.length,
    valid,
    invalid,
    skipped,
    results,
  };
}
