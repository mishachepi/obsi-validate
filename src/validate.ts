import matter from "gray-matter";
import type {
  RawFile,
  VaultSchema,
  ValidateOptions,
  VaultIndex,
  LinkConstraints,
  ValidationResult,
  ValidationSummary,
  ValidationError,
} from "./types.js";

const DEFAULT_TYPE_KEY = "type_key";

/** Validate a single file's frontmatter against the vault schema */
export function validateFile(
  file: RawFile,
  schema: VaultSchema,
  options?: ValidateOptions,
): ValidationResult {
  const typeKeyField = options?.typeKeyField ?? DEFAULT_TYPE_KEY;

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
  const rawEntityType = data[typeKeyField];
  const defaultType = options?.defaultEntityType;

  // Validate entity type field is a string (not array or object)
  if (rawEntityType !== undefined && typeof rawEntityType !== "string") {
    return {
      file: file.path,
      entityType: null,
      valid: false,
      errors: [
        { field: typeKeyField, message: `${typeKeyField} must be a string, got ${typeof rawEntityType}`, received: rawEntityType },
      ],
      warnings: [],
    };
  }

  const entityType = (rawEntityType as string | undefined) ?? defaultType ?? undefined;

  if (!entityType) {
    return {
      file: file.path,
      entityType: null,
      valid: true,
      errors: [],
      warnings: [{ field: typeKeyField, message: `Missing ${typeKeyField}, skipped` }],
    };
  }

  const warnings: ValidationError[] = [];

  // Warn if using default entity type (not explicitly set)
  if (!rawEntityType && defaultType) {
    warnings.push({
      field: typeKeyField,
      message: `${typeKeyField} not set, using default "${defaultType}"`,
    });
  }

  const resolvedProps = schema.entityMap.get(entityType);
  if (!resolvedProps) {
    return {
      file: file.path,
      entityType,
      valid: true,
      errors: [],
      warnings: [
        ...warnings,
        { field: typeKeyField, message: `Unknown entity type: ${entityType}` },
      ],
    };
  }

  const errors: ValidationError[] = [];
  const propByName = new Map(resolvedProps.map((p) => [p.name, p]));
  const allowExtra = schema.allowExtraMap.get(entityType) ?? false;

  // Check each frontmatter field
  for (const [field, value] of Object.entries(data)) {
    if (field === typeKeyField) continue;

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

    // Custom post-validator (JS expression from vault YAML, receives `value`)
    // This is intentionally user-defined code from the vault owner's own schema files.
    // It runs in the same trust context as the vault itself — no untrusted input.
    if (prop.custom_validator) {
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function("value", `return (${prop.custom_validator})`);
        const customResult = fn(value);
        if (customResult === false) {
          errors.push({
            field,
            message: `Custom validation failed`,
            received: value,
          });
        } else if (typeof customResult === "string") {
          errors.push({
            field,
            message: customResult,
            received: value,
          });
        }
      } catch (e) {
        warnings.push({
          field,
          message: `Custom validator error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    // Link constraint validation
    if (prop.link_constraints && options?.vaultIndex) {
      const linkValues = Array.isArray(value) ? value : [value];
      for (const linkVal of linkValues) {
        const linkErrors = validateLinkTarget(
          String(linkVal),
          prop.link_constraints,
          options.vaultIndex,
          options.typeKeyField ?? DEFAULT_TYPE_KEY,
        );
        for (const msg of linkErrors) {
          errors.push({ field, message: msg, received: linkVal });
        }
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
  options?: ValidateOptions,
): ValidationSummary {
  const results: ValidationResult[] = [];
  let valid = 0;
  let invalid = 0;
  let skipped = 0;

  for (const file of files) {
    const result = validateFile(file, schema, options);
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

/** Normalize a wikilink value: strip [[]], !embed prefix, aliases, heading refs */
function normalizeLink(val: string): string {
  let s = val.trim();
  // Remove embed prefix
  if (s.startsWith("![[")) s = s.slice(1);
  if (s.startsWith("[[") && s.endsWith("]]")) {
    s = s.slice(2, -2);
  }
  // Handle [[path/Name|Alias]] → path/Name
  const pipe = s.indexOf("|");
  if (pipe >= 0) s = s.slice(0, pipe);
  // Handle [[Note#Heading]] → Note
  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(0, hash);
  return s.trim();
}

/** Validate a single link target against constraints */
function validateLinkTarget(
  rawLink: string,
  constraints: LinkConstraints,
  index: VaultIndex,
  typeKeyField: string,
): string[] {
  const linkName = normalizeLink(rawLink);
  if (!linkName) return [];

  const entry = index.get(linkName) ?? index.get(linkName.split("/").pop()!);
  if (!entry) {
    return [`Linked note "${linkName}" not found in vault`];
  }

  const errors: string[] = [];

  if (constraints.target_type_key) {
    const actual = entry.data[typeKeyField];
    if (actual !== constraints.target_type_key) {
      errors.push(
        `Linked "${linkName}" has ${typeKeyField}="${actual ?? "none"}", expected "${constraints.target_type_key}"`,
      );
    }
  }

  if (constraints.target_folder) {
    if (!entry.path.startsWith(constraints.target_folder)) {
      errors.push(
        `Linked "${linkName}" is not in folder "${constraints.target_folder}"`,
      );
    }
  }

  if (constraints.target_has_property) {
    if (!(constraints.target_has_property in entry.data)) {
      errors.push(
        `Linked "${linkName}" is missing property "${constraints.target_has_property}"`,
      );
    }
  }

  if (constraints.target_property_value) {
    const { property, value } = constraints.target_property_value;
    const actual = entry.data[property];
    if (String(actual) !== String(value)) {
      errors.push(
        `Linked "${linkName}" has ${property}="${actual ?? "none"}", expected "${value}"`,
      );
    }
  }

  return errors;
}
