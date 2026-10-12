import { noteBody, parseFrontmatter } from "./frontmatter.js";
import { parseWikilinkTarget, resolveLink } from "./link-index.js";
import { TASK_ENTITY, validateTaskIntake } from "./rules/task-intake.js";
import { DEFAULT_TYPE_KEY_FIELD, isSchemaDefinition } from "./schema.js";
import type {
  LinkConstraints,
  RawFile,
  ResolvedProperty,
  ShapeEngine,
  ValidateOptions,
  ValidationError,
  ValidationResult,
  ValidationSummary,
  VaultIndex,
  VaultSchema,
} from "./types.js";
import { asList, isEmptyValue } from "./values.js";

/** Validate one note: YAML → type → expected folder → shape engine →
 * custom validators and link constraints → task intake → (checkLinks) body
 * wikilinks and inline properties. */
export function validateFile(file: RawFile, schema: VaultSchema, options: ValidateOptions = {}): ValidationResult {
  const typeKeyField = options.typeKeyField ?? DEFAULT_TYPE_KEY_FIELD;
  const result = (entityType: string | null, errors: ValidationError[], warnings: ValidationError[]): ValidationResult => ({
    file: file.path,
    entityType,
    valid: errors.length === 0,
    errors,
    warnings,
  });

  let data: Record<string, unknown>;
  try {
    data = parseFrontmatter(file.content).data;
  } catch (e) {
    return result(null, [{ field: "_yaml", message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` }], []);
  }
  if (isSchemaDefinition(data)) return result(null, [], []);

  const ownType = isEmptyValue(data[typeKeyField]) ? undefined : data[typeKeyField];
  if (ownType !== undefined && typeof ownType !== "string") {
    return result(
      null,
      [{ field: typeKeyField, message: `${typeKeyField} must be a string, got ${Array.isArray(ownType) ? "list" : typeof ownType}`, received: ownType }],
      [],
    );
  }

  const notePath = vaultRelative(file.path, options.vaultRoot);
  const linkErrors = () =>
    options.checkLinks && options.vaultIndex
      ? [
          ...validateBodyLinks(file.content, options.vaultIndex, notePath),
          ...validateInlineProperties(file.content, schema, entityType ?? null, options.vaultIndex, typeKeyField, notePath),
        ]
      : [];

  const entityType = ownType ?? options.defaultEntityType;
  if (!entityType) {
    return result(null, linkErrors(), [{ field: typeKeyField, message: `Missing ${typeKeyField}, skipped` }]);
  }

  const warnings: ValidationError[] = [];
  if (ownType === undefined) {
    warnings.push({ field: typeKeyField, message: `${typeKeyField} not set, using default "${entityType}"` });
  }

  const props = schema.entityMap.get(entityType);
  if (!props) {
    // An error, not a warning: a typo or undeclared type must fail every caller.
    return result(entityType, [{ field: typeKeyField, message: `Unknown entity type: ${entityType}` }], warnings);
  }

  const errors: ValidationError[] = [];

  const expectedFolder = schema.expectedFolderMap.get(entityType)?.replace(/[/\\]+$/, "");
  if (expectedFolder && !notePath.startsWith(expectedFolder + "/")) {
    errors.push({
      field: "__path__",
      message: `File must be in folder "${expectedFolder}/"`,
      expected: expectedFolder,
      received: file.path,
    });
  }

  // A defaulted type counts as the note's type field, so the default's own
  // `type_key: {required: true}` does not fail every untyped note.
  const shapeData = ownType === undefined ? { ...data, [typeKeyField]: entityType } : data;
  const shape = (options.shapeEngine ?? zodShapeEngine)(shapeData, entityType, schema, typeKeyField);
  errors.push(...shape.errors);
  warnings.push(...shape.warnings);

  const propByName = new Map(props.map((p) => [p.name, p]));
  for (const [field, value] of Object.entries(data)) {
    const prop = field === typeKeyField ? undefined : propByName.get(field);
    if (!prop || (prop.nullable && isEmptyValue(value))) continue;

    if (prop.customCheck) {
      const outcome = runCustomCheck(prop, value);
      if (outcome.error) errors.push({ field, message: outcome.error, received: value });
      if (outcome.warning) warnings.push({ field, message: outcome.warning });
    }

    if (prop.link_constraints && options.vaultIndex) {
      for (const link of asList(value)) {
        for (const message of validateLinkTarget(String(link), prop.link_constraints, options.vaultIndex, typeKeyField, notePath)) {
          errors.push({ field, message, received: link });
        }
      }
    }
  }

  if (entityType === TASK_ENTITY) errors.push(...validateTaskIntake(file.content, data));
  errors.push(...linkErrors());

  return result(entityType, errors, warnings);
}

/** Path relative to the vault root, when the caller passed absolute paths. */
function vaultRelative(path: string, vaultRoot?: string): string {
  const root = vaultRoot?.replace(/[/\\]+$/, "");
  return root && path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
}

/** Run a property's custom validator. It returns true to pass, false or a
 * message to fail; a thrown error is reported as a warning. */
function runCustomCheck(prop: ResolvedProperty, value: unknown): { error?: string; warning?: string } {
  try {
    const outcome = prop.customCheck!(value);
    if (outcome === false) return { error: "Custom validation failed" };
    if (typeof outcome === "string") return { error: outcome };
    return {};
  } catch (e) {
    return { warning: `Custom validator error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Default shape engine: per-property Zod validators from schema.ts. */
export const zodShapeEngine: ShapeEngine = (data, entityType, schema, typeKeyField) => {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const props = schema.entityMap.get(entityType) ?? [];
  const propByName = new Map(props.map((p) => [p.name, p]));
  const allowExtra = schema.allowExtraMap.get(entityType) ?? false;
  const patterns = schema.propertyPatternMap.get(entityType) ?? [];

  for (const [field, value] of Object.entries(data)) {
    if (field === typeKeyField) continue;
    const prop = propByName.get(field);
    if (!prop) {
      // A declared key family (property_patterns) is known without being listed.
      if (!allowExtra && !patterns.some((re) => re.test(field))) {
        warnings.push({ field, message: "Unknown property for this entity" });
      }
      continue;
    }
    if (!prop.validator || (prop.nullable && isEmptyValue(value))) continue;
    const parsed = prop.validator.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ field, message: issue.message, expected: prop.property_type, received: value });
      }
    }
  }

  for (const prop of props) {
    if (prop.required && !(prop.name in data) && !isExemptFromRequired(prop, data)) {
      errors.push({ field: prop.name, message: "Required field is missing" });
    }
  }
  return { errors, warnings };
};

/** True when a `required_unless` condition lifts the requirement: ANY listed
 * field holds ANY of its listed values. Only a single value can match (a list
 * never does); numbers compare by their string form. */
export function isExemptFromRequired(prop: Pick<ResolvedProperty, "required_unless">, data: Record<string, unknown>): boolean {
  return Object.entries(prop.required_unless ?? {}).some(([field, values]) => {
    const actual = data[field];
    return (typeof actual === "string" || typeof actual === "number") && values.includes(String(actual));
  });
}

/** Note body with regions whose links are examples, not live links, removed:
 * HTML comments, fenced code blocks and inline code. */
function linkableBody(content: string): string {
  return noteBody(content)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\r\n]+`/g, "");
}

/** Errors for body wikilinks that resolve to no file. Each target is reported
 * once. `fromPath` is the note's own vault path. */
export function validateBodyLinks(content: string, index: VaultIndex, fromPath?: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  // No newline or `[` inside a target, so an unclosed `[[` cannot swallow what follows.
  for (const match of linkableBody(content).matchAll(/\[\[([^\]\[\r\n]+)\]\]/g)) {
    const target = parseWikilinkTarget(match[1]);
    const key = target.toLowerCase();
    if (!target || seen.has(key)) continue;
    seen.add(key);
    if (!resolveLink(index, target, fromPath)) {
      errors.push({ field: "__body_link__", message: `Broken wikilink: [[${target}]] not found in vault`, received: target });
    }
  }
  return errors;
}

/** An inline value (always text) as the property's declared type: lists are
 * split on commas; numbers and booleans are converted only when the text is
 * unambiguous, so malformed values still fail. */
function coerceInlineValue(raw: string, propertyType: string): unknown {
  switch (propertyType) {
    case "list":
    case "links":
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    case "number":
      return raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    case "boolean":
      return raw === "true" ? true : raw === "false" ? false : raw;
    default:
      return raw;
  }
}

/** Errors for inline `[key:: value]` properties in the body: values are
 * mapped through `etl.value_map`, coerced and checked against the property;
 * wikilink values must resolve and meet the property's link constraints. */
export function validateInlineProperties(
  content: string,
  schema: VaultSchema,
  entityType: string | null,
  index: VaultIndex,
  typeKeyField: string,
  fromPath?: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const props = entityType ? schema.entityMap.get(entityType) ?? [] : [];
  const inline = /\[([a-z_][a-z0-9_]*)::((?:\[\[[^\[\]\r\n]+\]\]|[^\]\r\n])*)\]/gi;

  for (const match of linkableBody(content).matchAll(inline)) {
    const key = match[1];
    const raw = match[2].trim();
    const field = `__inline__${key}`;
    const isLink = /^\[\[[^\]\[\r\n]+\]\]$/.test(raw);
    const prop = props.find((p) => p.name === key);

    if (prop) {
      const mapped = prop.value_map && Object.prototype.hasOwnProperty.call(prop.value_map, raw) ? prop.value_map[raw] : undefined;
      const value = mapped ?? (isLink ? raw : coerceInlineValue(raw, prop.property_type));
      const parsed = prop.validator?.safeParse(value);
      for (const issue of parsed && !parsed.success ? parsed.error.issues : []) {
        errors.push({ field, message: `Inline [${key}::${raw}]: ${issue.message}`, received: value });
      }
      if (prop.link_constraints && isLink) {
        for (const message of validateLinkTarget(raw, prop.link_constraints, index, typeKeyField, fromPath)) {
          errors.push({ field, message: `Inline [${key}::${raw}]: ${message}`, received: raw });
        }
      }
    }

    if (isLink) {
      const target = parseWikilinkTarget(raw);
      if (target && !resolveLink(index, target, fromPath)) {
        errors.push({ field, message: `Inline [${key}::[[${target}]]]: linked note not found in vault`, received: target });
      }
    }
  }
  return errors;
}

/** Add one result to a summary's counters: no type and no errors = skipped. */
export function countResult(summary: Omit<ValidationSummary, "results">, result: ValidationResult): void {
  summary.total++;
  if (result.entityType === null && result.valid) summary.skipped++;
  else if (result.valid) summary.valid++;
  else summary.invalid++;
}

/** Validate many files; every result is kept. */
export function validateFiles(files: RawFile[], schema: VaultSchema, options?: ValidateOptions): ValidationSummary {
  const summary: ValidationSummary = { total: 0, valid: 0, invalid: 0, skipped: 0, results: [] };
  for (const file of files) {
    const result = validateFile(file, schema, options);
    countResult(summary, result);
    summary.results.push(result);
  }
  return summary;
}

/** Errors for a link that does not resolve or whose target breaks the constraints. */
function validateLinkTarget(
  link: string,
  constraints: LinkConstraints,
  index: VaultIndex,
  typeKeyField: string,
  fromPath?: string,
): string[] {
  const name = parseWikilinkTarget(link);
  if (!name) return [];
  const target = resolveLink(index, name, fromPath);
  if (!target) return [`Linked note "${name}" not found in vault`];

  const errors: string[] = [];
  if (constraints.target_type_key) {
    const actual = target.data[typeKeyField];
    const allowed = asList(constraints.target_type_key).map(String);
    if (typeof actual !== "string" || !allowed.includes(actual)) {
      errors.push(`Linked "${name}" has ${typeKeyField}="${actual ?? "none"}", expected one of: ${allowed.join(", ")}`);
    }
  }
  if (constraints.target_folder && !target.path.startsWith(constraints.target_folder)) {
    errors.push(`Linked "${name}" is not in folder "${constraints.target_folder}"`);
  }
  if (constraints.target_has_property && !(constraints.target_has_property in target.data)) {
    errors.push(`Linked "${name}" is missing property "${constraints.target_has_property}"`);
  }
  if (constraints.target_property_value) {
    const { property, value } = constraints.target_property_value;
    const actual = target.data[property];
    if (String(actual) !== String(value)) {
      errors.push(`Linked "${name}" has ${property}="${actual ?? "none"}", expected "${value}"`);
    }
  }
  return errors;
}
