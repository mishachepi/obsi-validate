import type { ZodTypeAny } from "zod";

/** Raw file content as read from disk */
export type RawFile = { path: string; content: string };

/** Property field config as declared in entity's properties block */
export type EntityPropertyConfig = {
  required?: boolean;
  /**
   * Required, EXCEPT when a sibling field holds one of the listed values:
   *
   *   dod:
   *     required_unless:
   *       status: [Closed, Rejected]
   *
   * Useful for rules added after notes accumulated, e.g. closed notes that
   * predate the field. Declaring it implies `required: true` unless `required`
   * is explicitly false.
   *
   * Exempt when ANY listed field holds ANY of its values. The field must hold a
   * single value (not a list); numbers compare by their string form; matching
   * is exact, so `Closed` does not match `closed`.
   */
  required_unless?: Record<string, string[]>;
};

/** Constraints for link/list properties — validate what the link points to */
export type LinkConstraints = {
  /** Target note must have one of these entity types */
  target_type_key?: string | string[];
  /** Target note must be in this folder (prefix match) */
  target_folder?: string;
  /** Target note must have this property defined */
  target_has_property?: string;
  /** Target note's property must equal this value */
  target_property_value?: { property: string; value: string };
};

/** Raw property schema as read from vault property file frontmatter */
export type PropertySchema = {
  name: string;
  property_type: string;
  allowed_values?: (string | number)[];
  min_value?: number;
  max_value?: number;
  unit?: string;
  /** Constraints for link/list targets */
  link_constraints?: LinkConstraints;
  /** If true, null/empty values are valid for this property */
  nullable?: boolean;
  /** JS expression for custom validation: sees `value`, returns true to pass, false or a message to fail */
  custom_validator?: string;
  /** `custom_validator` compiled once at schema load */
  customCheck?: (value: unknown) => unknown;
  /**
   * `etl.value_map` from the property note: words that stand for values of the
   * declared type (e.g. mood `good -> 8`). Inline `[mood::good]` values are
   * mapped through it before type-checking.
   */
  value_map?: Record<string, unknown>;
  /** Compiled Zod validator for this property's value */
  validator?: ZodTypeAny;
  /** Folder relative to properties dir (for UI grouping) */
  folder?: string;
  /** Original file path in vault (for writing back) */
  sourcePath?: string;
};

/** Entity type as read from vault entity file frontmatter */
export type EntitySchema = {
  name: string;
  /** Property name → config (required, etc.) */
  properties: Record<string, EntityPropertyConfig>;
  /** Parent entity name for inheritance */
  extends?: string;
  /** If true, extra fields not in properties don't produce warnings */
  allow_extra?: boolean;
  /**
   * Regexes naming whole FAMILIES of valid keys, for fields a generator
   * invents at runtime (e.g. `time_<area>`, `<category>_hours` written by the
   * day ETL). A field matching any of these is known, so the family need not be
   * enumerated — enumerating it demonstrably does not converge: every Area
   * rename adds another historical key.
   *
   * Weaker than a named property ON PURPOSE: it asserts the NAME is expected,
   * not that the VALUE is correct, and it cannot tell `time_wgg` from a typo
   * `time_wgh`. Use it only where the key set is genuinely open; a fixed set
   * still belongs in `properties`.
   */
  property_patterns?: string[];
  /** Files with this entity type must be in this folder (prefix match) */
  expected_folder?: string;
  /** Folder relative to entities dir (for UI grouping) */
  folder?: string;
  /** Original file path in vault (for writing back) */
  sourcePath?: string;
};

/** Resolved property: property schema + per-entity config */
export type ResolvedProperty = PropertySchema & {
  required: boolean;
  /** Condition that lifts `required` — see EntityPropertyConfig.required_unless */
  required_unless?: Record<string, string[]>;
  /** Which entity this property was inherited from (undefined = own) */
  inheritedFrom?: string;
};

/** Complete vault schema with derived entity→properties mapping */
export type VaultSchema = {
  entities: EntitySchema[];
  properties: PropertySchema[];
  /** Entity name → its resolved properties (schema + required flag) */
  entityMap: Map<string, ResolvedProperty[]>;
  /** Entity name → allow_extra flag */
  allowExtraMap: Map<string, boolean>;
  /** Entity name → compiled property_patterns (inherited through `extends`) */
  propertyPatternMap: Map<string, RegExp[]>;
  /** Entity name → expected folder path */
  expectedFolderMap: Map<string, string>;
};

/** Single validation error */
export type ValidationError = {
  field: string;
  message: string;
  expected?: string;
  received?: unknown;
};

/** Result of validating one file */
export type ValidationResult = {
  file: string;
  entityType: string | null;
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
};

/** Summary of validating multiple files */
export type ValidationSummary = {
  total: number;
  valid: number;
  invalid: number;
  skipped: number;
  results: ValidationResult[];
};

/** A linkable file: vault-relative path and parsed frontmatter. */
export type VaultIndexEntry = { path: string; data: Record<string, unknown> };

/** Lower-case link key → matching files, best first. Build with
 * buildIndexFromEntries, query with resolveLink (link-index.ts). */
export type VaultIndex = Map<string, VaultIndexEntry[]>;

/**
 * The "shape" half of validation: field types, enum/range, unknown fields,
 * required / required_unless. Everything else in validateFile (expected_folder,
 * custom_validator, link_constraints, task-intake, body links) is bespoke and
 * runs identically regardless of engine. Default engine: Zod (schema.ts);
 * alternative: mdbase JSON Schema (src/mdbase/adapter.ts).
 */
export type ShapeEngine = (
  data: Record<string, unknown>,
  entityType: string,
  schema: VaultSchema,
  typeKeyField: string,
) => { errors: ValidationError[]; warnings: ValidationError[] };

/** Options for validation */
export type ValidateOptions = {
  /** Engine for the shape half of validation (default: Zod) */
  shapeEngine?: ShapeEngine;
  /** Frontmatter field name that identifies entity type (default: "entity") */
  typeKeyField?: string;
  /** Default entity type if typeKeyField is missing (empty = skip file) */
  defaultEntityType?: string;
  /** Vault index for cross-file link validation */
  vaultIndex?: VaultIndex;
  /** When true, also check body wikilinks and inline properties */
  checkLinks?: boolean;
  /** Report body wikilink and inline-property findings as errors, not warnings */
  strictLinks?: boolean;
  /** Vault root when file paths are absolute (CLI); folder rules compare
   * vault-relative paths. Plugin paths are already vault-relative. */
  vaultRoot?: string;
};
