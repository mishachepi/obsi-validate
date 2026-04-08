import type { ZodTypeAny } from "zod";

/** Raw file content as read from disk */
export type RawFile = { path: string; content: string };

/** Property field config as declared in entity's properties block */
export type EntityPropertyConfig = {
  required?: boolean;
};

/** Constraints for link/list properties — validate what the link points to */
export type LinkConstraints = {
  /** Target note must have this value in its type key field */
  target_type_key?: string;
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
  /** JS expression for custom post-validation (receives `value` variable, returns true/false or error string) */
  custom_validator?: string;
  /** Compiled Zod validator for this property's value */
  validator?: ZodTypeAny;
  /** Folder relative to properties dir (for UI grouping) */
  folder?: string;
};

/** Entity type as read from vault entity file frontmatter */
export type EntitySchema = {
  name: string;
  /** Property name → config (required, etc.) */
  properties: Record<string, EntityPropertyConfig>;
  /** If true, extra fields not in properties don't produce warnings */
  allow_extra?: boolean;
};

/** Resolved property: property schema + per-entity config */
export type ResolvedProperty = PropertySchema & {
  required: boolean;
};

/** Complete vault schema with derived entity→properties mapping */
export type VaultSchema = {
  entities: EntitySchema[];
  properties: PropertySchema[];
  /** Entity name → its resolved properties (schema + required flag) */
  entityMap: Map<string, ResolvedProperty[]>;
  /** Entity name → allow_extra flag */
  allowExtraMap: Map<string, boolean>;
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
  /** Frontmatter field name that identifies entity type (default: "type_key") */
  typeKeyField?: string;
  /** Vault index for cross-file link validation */
  vaultIndex?: VaultIndex;
};
