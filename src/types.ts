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
   * For rules introduced after history accumulated. Making `dod` unconditionally
   * required marked 196 already-closed notes invalid forever — they cannot be
   * fixed, because inventing an acceptance criterion for someone else's finished
   * work is fabrication. Permanent unfixable noise teaches people to ignore the
   * validator exactly where it still matters (139 open notes genuinely missing it).
   *
   * Declaring this IMPLIES `required: true` — "required unless X" is a statement
   * of requiredness. Needing both keys would mean a schema that carries the
   * exemption and enforces nothing, which is the silent-no-op this replaces.
   *
   * Exempt if ANY listed field matches ANY of its values. Comparison is by exact
   * string, so `Closed` does not match `closed` — statuses here are a controlled
   * vocabulary, and loose matching would quietly excuse typos.
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
  /** JS expression for custom post-validation (receives `value` variable, returns true/false or error string) */
  custom_validator?: string;
  /**
   * `etl.value_map` from the property note: the vocabulary the day ETL folds into
   * the declared type, e.g. mood `good -> 8`.
   *
   * The validator must apply the SAME map before type-checking an inline marker.
   * `fm` reads it and computes `mood: 8` correctly; without it here,
   * `[mood::good]` was reported as "expected number, received string" on data
   * that is correct end-to-end — and validate-hook runs on every edit, so the
   * false failure fires on every future touch of those days.
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

/** Map of normalized note name → its frontmatter data, for link validation */
export type VaultIndex = Map<string, { path: string; data: Record<string, unknown> }>;

/** Options for validation */
export type ValidateOptions = {
  /** Frontmatter field name that identifies entity type (default: "entity") */
  typeKeyField?: string;
  /** Default entity type if typeKeyField is missing (empty = skip file) */
  defaultEntityType?: string;
  /** Vault index for cross-file link validation */
  vaultIndex?: VaultIndex;
  /** When true, also validate body wikilinks and inline properties */
  checkLinks?: boolean;
};
