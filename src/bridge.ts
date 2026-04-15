import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { loadSchema } from "./schema";
import { validateFile, validateFiles } from "./validate";
import {
  generateEntityFrontmatter,
  generatePropertyFrontmatter,
} from "./ui/yamlWriter";
import matter from "gray-matter";
import type {
  RawFile,
  VaultSchema,
  VaultIndex,
  ValidateOptions,
  ValidationResult,
  ValidationSummary,
} from "./types";

/** Convert TFile to RawFile using cachedRead */
export async function tFileToRawFile(
  app: App,
  file: TFile,
): Promise<RawFile> {
  const content = await app.vault.cachedRead(file);
  return { path: file.path, content };
}

/** Recursively collect .md files under a folder, skipping archive/ */
function collectMdFiles(folder: TFolder): TFile[] {
  const results: TFile[] = [];
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === "md") {
      results.push(child);
    } else if (child instanceof TFolder && child.name !== "_deprecated") {
      results.push(...collectMdFiles(child));
    }
  }
  return results;
}

/** Get all .md files under a vault path */
function getFilesUnderPath(app: App, folderPath: string): TFile[] {
  const abstractFile = app.vault.getAbstractFileByPath(folderPath);
  if (abstractFile instanceof TFolder) {
    return collectMdFiles(abstractFile);
  }
  return [];
}

/** Resolve schema directory paths, handling "." as vault root */
export function resolveSchemaPaths(schemaDir: string): {
  entitiesPath: string;
  propertiesPath: string;
} {
  const base = schemaDir === "." ? "" : schemaDir;
  return {
    entitiesPath: base ? `${base}/entities` : "entities",
    propertiesPath: base ? `${base}/properties` : "properties",
  };
}

/** Load schema from vault entity/property files, with optional caching */
export async function ensureSchema(
  app: App,
  schemaDir: string,
  cached: VaultSchema | null,
): Promise<VaultSchema> {
  if (cached) return cached;

  const { entitiesPath, propertiesPath } = resolveSchemaPaths(schemaDir);
  const entityTFiles = getFilesUnderPath(app, entitiesPath);
  const propertyTFiles = getFilesUnderPath(app, propertiesPath);

  const [entityFiles, propertyFiles] = await Promise.all([
    Promise.all(entityTFiles.map((f) => tFileToRawFile(app, f))),
    Promise.all(propertyTFiles.map((f) => tFileToRawFile(app, f))),
  ]);

  return loadSchema(entityFiles, propertyFiles);
}

/** Validate a single file against schema */
export async function bridgeValidateFile(
  app: App,
  file: TFile,
  schema: VaultSchema,
  options?: ValidateOptions,
  cachedVaultIndex?: VaultIndex,
): Promise<ValidationResult> {
  const rawFile = await tFileToRawFile(app, file);
  const hasLinkConstraints = schema.properties.some((p) => p.link_constraints);
  const opts = hasLinkConstraints
    ? { ...options, vaultIndex: cachedVaultIndex ?? await buildVaultIndex(app) }
    : options;
  return validateFile(rawFile, schema, opts);
}

/** Build vault index: normalized note name → frontmatter data */
export async function buildVaultIndex(app: App): Promise<VaultIndex> {
  const index: VaultIndex = new Map();
  const files = app.vault.getMarkdownFiles();
  for (const file of files) {
    const content = await app.vault.cachedRead(file);
    try {
      const data = matter(content).data;
      const baseName = file.basename;
      // Full path always wins (unique key)
      const pathNoExt = file.path.replace(/\.md$/, "");
      index.set(pathNoExt, { path: file.path, data });
      // Basename only if no duplicate — first-wins for ambiguous short links
      if (!index.has(baseName)) {
        index.set(baseName, { path: file.path, data });
      }
    } catch {
      // Skip files with YAML errors
    }
  }
  return index;
}

/** Validate all markdown files in vault */
export async function bridgeValidateVault(
  app: App,
  schema: VaultSchema,
  options?: ValidateOptions,
): Promise<ValidationSummary> {
  const allFiles = app.vault.getMarkdownFiles();
  const rawFiles = await Promise.all(
    allFiles.map((f) => tFileToRawFile(app, f)),
  );

  // Build vault index if any property has link constraints
  const hasLinkConstraints = schema.properties.some((p) => p.link_constraints);
  const opts = hasLinkConstraints
    ? { ...options, vaultIndex: await buildVaultIndex(app) }
    : options;

  return validateFiles(rawFiles, schema, opts);
}

// --- Write functions ---

/** Validate that a path doesn't escape the vault */
function assertSafePath(path: string): void {
  // Normalize redundant segments before checking
  const normalized = path.replace(/\/\.\//g, "/").replace(/\/+/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error(`Unsafe path: ${path}`);
  }
}

/** Ensure a vault folder exists, creating it and parents if needed */
async function ensureDirectoryExists(app: App, path: string): Promise<void> {
  assertSafePath(path);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) return;

  // Create parents first
  const parts = path.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const f = app.vault.getAbstractFileByPath(current);
    if (!f) {
      await app.vault.createFolder(current);
    }
  }
}

/** Create or modify a file in the vault */
async function createOrModify(
  app: App,
  filePath: string,
  content: string,
): Promise<void> {
  assertSafePath(filePath);
  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(filePath, content);
  }
}

/** Write an entity file to the vault */
export async function writeEntityFile(
  app: App,
  schemaDir: string,
  name: string,
  allowExtra: boolean,
  properties: Record<string, { required?: boolean }>,
  extendsEntity?: string,
  sourcePath?: string,
): Promise<void> {
  let filePath: string;
  if (sourcePath) {
    filePath = sourcePath;
  } else {
    const { entitiesPath } = resolveSchemaPaths(schemaDir);
    await ensureDirectoryExists(app, entitiesPath);
    filePath = `${entitiesPath}/${name}_entity.md`;
  }
  const content = generateEntityFrontmatter(name, allowExtra, properties, extendsEntity);
  await createOrModify(app, filePath, content);
}

/** Write a property file to the vault */
export async function writePropertyFile(
  app: App,
  schemaDir: string,
  name: string,
  type: string,
  opts?: {
    allowed_values?: (string | number)[];
    min_value?: number;
    max_value?: number;
    unit?: string;
    nullable?: boolean;
    custom_validator?: string;
    link_constraints?: {
      target_type_key?: string | string[];
      target_folder?: string;
      target_has_property?: string;
      target_property_value?: { property: string; value: string };
    };
  },
  sourcePath?: string,
): Promise<void> {
  let filePath: string;
  if (sourcePath) {
    filePath = sourcePath;
  } else {
    const { propertiesPath } = resolveSchemaPaths(schemaDir);
    await ensureDirectoryExists(app, propertiesPath);
    filePath = `${propertiesPath}/${name}_property.md`;
  }
  const content = generatePropertyFrontmatter(name, type, opts);
  await createOrModify(app, filePath, content);
}

/** Archive a schema file (move to archive/ subdirectory) */
export async function deprecateSchemaFile(
  app: App,
  filePath: string,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;

  // Determine archive path: insert "archive/" before the filename
  const parts = filePath.split("/");
  const fileName = parts.pop()!;
  const parentDir = parts.join("/");
  const archiveDir = parentDir ? `${parentDir}/_deprecated` : "_deprecated";
  const archivePath = `${archiveDir}/${fileName}`;

  await ensureDirectoryExists(app, archiveDir);
  await app.vault.rename(file, archivePath);
}

/** Get the vault path of an entity file */
export function entityFilePath(schemaDir: string, name: string): string {
  const { entitiesPath } = resolveSchemaPaths(schemaDir);
  return `${entitiesPath}/${name}_entity.md`;
}

/** Get the vault path of a property file */
export function propertyFilePath(schemaDir: string, name: string): string {
  const { propertiesPath } = resolveSchemaPaths(schemaDir);
  return `${propertiesPath}/${name}_property.md`;
}
