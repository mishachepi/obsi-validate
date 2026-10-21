// Library entry point: runtime-agnostic, no file system access.
export { loadSchema, parseEntities, parseProperties, detectTypeKeyField, resolveTypeKeyField, DEFAULT_TYPE_KEY_FIELD } from "./schema.js";
export { validateFile, validateFiles, zodShapeEngine } from "./validate.js";
export { buildIndexFromEntries, resolveLink, parseWikilinkTarget } from "./link-index.js";
export { mdbaseShapeEngine } from "./mdbase/adapter.js";
export type {
  RawFile,
  EntityPropertyConfig,
  PropertySchema,
  EntitySchema,
  ResolvedProperty,
  VaultSchema,
  LinkConstraints,
  VaultIndex,
  VaultIndexEntry,
  ShapeEngine,
  ValidateOptions,
  ValidationError,
  ValidationResult,
  ValidationSummary,
} from "./types.js";
