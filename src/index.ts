// Library entry point — runtime-agnostic, no fs access
export { loadSchema, parseEntities, parseProperties } from "./schema.js";
export { validateFile, validateFiles } from "./validate.js";
export type {
  RawFile,
  EntityPropertyConfig,
  PropertySchema,
  EntitySchema,
  ResolvedProperty,
  VaultSchema,
  ValidationError,
  ValidationResult,
  ValidationSummary,
} from "./types.js";
