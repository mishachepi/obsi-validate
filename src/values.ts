import type { ResolvedProperty } from "./types.js";

/** True for a frontmatter value that holds nothing: null, undefined or "". */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** A frontmatter value as a list of non-empty items. A scalar counts as a
 * one-item list (`tags: x` is as legal as `tags: [x]`). */
export function asList(value: unknown): unknown[] {
  const items = Array.isArray(value) ? value : [value];
  return items.filter((v) => !isEmptyValue(v));
}

/** A YAML date as text: `YYYY-MM-DD` at midnight UTC, else the full ISO form. */
function dateText(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

/** A value converted to the property's type where the intent is unambiguous,
 * as mdbase does: numbers, booleans and dates count as text; numeric text
 * counts as a number; "true"/"false" (any case) count as booleans. Anything
 * else is returned unchanged and checked as is. */
export function coerceValue(propertyType: string, value: unknown): unknown {
  switch (propertyType) {
    case "string":
    case "time":
    case "link":
    case "emoji":
    case "enum":
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (value instanceof Date) return dateText(value);
      return value;
    case "date":
    case "datetime":
      return value instanceof Date ? dateText(value) : value;
    case "number":
      return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
    case "boolean":
      if (typeof value === "string" && /^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
      return value;
    default:
      return value;
  }
}

/** Frontmatter as the value checks see it. A declared property left empty
 * counts as not set (so only `required` can fail it), unless it is `nullable`,
 * where empty is a value of its own (`null`). Other values are coerced to the
 * property's type. Undeclared keys pass through unchanged. */
export function normalizeFrontmatter(
  data: Record<string, unknown>,
  props: readonly ResolvedProperty[],
): Record<string, unknown> {
  const byName = new Map(props.map((p) => [p.name, p]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const prop = byName.get(key);
    if (!prop) out[key] = value;
    else if (!isEmptyValue(value)) out[key] = coerceValue(prop.property_type, value);
    else if (prop.nullable) out[key] = null;
  }
  return out;
}

/** A value as named in a message: `"text"`, `5`, `true`, `a list`, `a mapping`. */
export function describeValue(value: unknown): string {
  if (Array.isArray(value)) return "a list";
  if (value instanceof Date) return dateText(value);
  if (value === null || value === undefined) return "nothing";
  if (typeof value === "object") return "a mapping";
  if (typeof value === "string") return JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}...` : value);
  return String(value);
}

const EXPECTED: Record<string, string> = {
  string: "text",
  time: "a time",
  date: "a date",
  datetime: "a date and time",
  number: "a number",
  boolean: "true or false",
  link: "a link",
  links: "a link or a list of links",
  list: "a list or a single value",
  emoji: "emoji",
};

/** The message for a value that fails its property's checks. */
export function valueError(prop: ResolvedProperty, value: unknown): string {
  if (prop.property_type === "enum" && prop.allowed_values?.length) {
    return `${describeValue(value)} is not an allowed value. Allowed: ${prop.allowed_values.join(", ")}`;
  }
  if (prop.property_type === "number" && typeof value === "number") {
    if (prop.min_value != null && value < prop.min_value) return `Must be at least ${prop.min_value}, got ${value}`;
    if (prop.max_value != null && value > prop.max_value) return `Must be at most ${prop.max_value}, got ${value}`;
  }
  return `Expected ${EXPECTED[prop.property_type] ?? prop.property_type}, got ${describeValue(value)}`;
}

export const REQUIRED_MESSAGE = "Required field is missing";

/** The warning for a frontmatter key the entity does not list. */
export function unknownPropertyMessage(entityType: string): string {
  return `Not a property of ${entityType}`;
}

/** How a result's `field` is shown: a frontmatter property by its name, the
 * other checks by where the problem is. `property` is the name of the
 * frontmatter property, when there is one. */
export function fieldLabel(field: string): { label: string; property?: string } {
  if (field === "_yaml") return { label: "frontmatter" };
  if (field === "__path__") return { label: "folder" };
  if (field === "__body_link__") return { label: "body" };
  if (field.startsWith("__inline__")) return { label: `${field.slice("__inline__".length)} (inline)` };
  return { label: field, property: field };
}
