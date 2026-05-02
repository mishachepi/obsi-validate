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
  ResolvedProperty,
} from "./types.js";
import { DEFAULT_ENTITY_FIELD } from "./constants.js";

/** Validate a single file's frontmatter against the vault schema */
export function validateFile(
  file: RawFile,
  schema: VaultSchema,
  options?: ValidateOptions,
): ValidationResult {
  const typeKeyField = options?.typeKeyField ?? DEFAULT_ENTITY_FIELD;

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
  // Skip schema definition files (entity/property declarations)
  if (data.entity_name || data.property_name) {
    return { file: file.path, entityType: null, valid: true, errors: [], warnings: [] };
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
    // Still check body links even without entity type
    const errors: ValidationError[] = [];
    if (options?.checkLinks && options.vaultIndex) {
      errors.push(...validateBodyLinks(file.content, options.vaultIndex));
      errors.push(...validateInlineProperties(file.content, schema, null, options.vaultIndex, options.typeKeyField ?? DEFAULT_ENTITY_FIELD));
    }
    return {
      file: file.path,
      entityType: null,
      valid: errors.length === 0,
      errors,
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

  // Check expected folder constraint
  const expectedFolderRaw = schema.expectedFolderMap.get(entityType);
  const expectedFolder = expectedFolderRaw?.replace(/[/\\]+$/, "");
  if (expectedFolder && !file.path.startsWith(expectedFolder + "/")) {
    errors.push({
      field: "__path__",
      message: `File must be in folder "${expectedFolder}/"`,
      expected: expectedFolder,
      received: file.path,
    });
  }

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

    // Nullable properties accept null/undefined/empty string
    if (prop.nullable && (value === null || value === undefined || value === "")) continue;

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
          options.typeKeyField ?? DEFAULT_ENTITY_FIELD,
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

  // Body link and inline property validation
  if (options?.checkLinks && options.vaultIndex) {
    const bodyLinkErrors = validateBodyLinks(file.content, options.vaultIndex);
    errors.push(...bodyLinkErrors);

    const inlineErrors = validateInlineProperties(
      file.content,
      schema,
      entityType,
      options.vaultIndex,
      options.typeKeyField ?? DEFAULT_ENTITY_FIELD,
    );
    errors.push(...inlineErrors);
  }

  return {
    file: file.path,
    entityType,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Extract body content (everything after frontmatter) */
function extractBody(content: string): string {
  const firstSep = content.indexOf("---");
  if (firstSep === -1) return content;
  const secondSep = content.indexOf("---", firstSep + 3);
  if (secondSep === -1) return content;
  return content.slice(secondSep + 3);
}

/** Validate body wikilinks exist in vault index */
export function validateBodyLinks(
  content: string,
  index: VaultIndex,
): ValidationError[] {
  const body = extractBody(content);
  const errors: ValidationError[] = [];
  const linkRegex = /\[\[([^\]]+)\]\]/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(body)) !== null) {
    const raw = match[1];
    let target = raw;
    const pipe = target.indexOf("|");
    if (pipe >= 0) target = target.slice(0, pipe);
    const hash = target.indexOf("#");
    if (hash >= 0) target = target.slice(0, hash);
    target = target.trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);

    const entry = index.get(target) ?? index.get(target.split("/").pop()!);
    if (!entry) {
      errors.push({
        field: "__body_link__",
        message: `Broken wikilink: [[${target}]] not found in vault`,
        received: target,
      });
    }
  }
  return errors;
}

/** Validate inline Dataview properties [key::value] in body */
export function validateInlineProperties(
  content: string,
  schema: VaultSchema,
  entityType: string | null,
  index: VaultIndex,
  typeKeyField: string,
): ValidationError[] {
  const body = extractBody(content);
  const errors: ValidationError[] = [];
  const inlineRegex = /\[([a-z_][a-z0-9_]*)::([^\]]*)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = inlineRegex.exec(body)) !== null) {
    const key = match[1];
    const rawValue = match[2].trim();

    const linkMatch = rawValue.match(/^\[\[([^\]]+)\]\]$/);

    // Try to find property in schema for this entity type
    let prop: ResolvedProperty | undefined;
    if (entityType) {
      const resolvedProps = schema.entityMap.get(entityType);
      if (resolvedProps) {
        prop = resolvedProps.find((p) => p.name === key);
      }
    }

    if (prop) {
      const value = linkMatch ? `[[${linkMatch[1]}]]` : rawValue;
      if (prop.validator) {
        const result = prop.validator.safeParse(value);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push({
              field: `__inline__${key}`,
              message: `Inline [${key}::${rawValue}]: ${issue.message}`,
              received: value,
            });
          }
        }
      }
      if (prop.link_constraints && linkMatch) {
        const linkErrors = validateLinkTarget(
          `[[${linkMatch[1]}]]`,
          prop.link_constraints,
          index,
          typeKeyField,
        );
        for (const msg of linkErrors) {
          errors.push({
            field: `__inline__${key}`,
            message: `Inline [${key}::${rawValue}]: ${msg}`,
            received: rawValue,
          });
        }
      }
    }

    // For any wikilink value, check existence
    if (linkMatch) {
      let target = linkMatch[1];
      const pipe = target.indexOf("|");
      if (pipe >= 0) target = target.slice(0, pipe);
      const hash = target.indexOf("#");
      if (hash >= 0) target = target.slice(0, hash);
      target = target.trim();
      if (target) {
        const entry = index.get(target) ?? index.get(target.split("/").pop()!);
        if (!entry) {
          errors.push({
            field: `__inline__${key}`,
            message: `Inline [${key}::[[${target}]]]: linked note not found in vault`,
            received: target,
          });
        }
      }
    }
  }
  return errors;
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
    const actual = entry.data[typeKeyField] as string | undefined;
    const allowed = Array.isArray(constraints.target_type_key)
      ? constraints.target_type_key
      : [constraints.target_type_key];
    if (!actual || !allowed.includes(actual)) {
      errors.push(
        `Linked "${linkName}" has ${typeKeyField}="${actual ?? "none"}", expected one of: ${allowed.join(", ")}`,
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
