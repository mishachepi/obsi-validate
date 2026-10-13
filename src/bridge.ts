/** The plugin's link between the Obsidian vault and the validation core. */
import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { parseFrontmatter } from "./frontmatter";
import { buildIndexFromEntries } from "./link-index";
import { normalizeSchemaDir } from "./plugin-settings";
import { loadSchema } from "./schema";
import type {
  EntityPropertyConfig,
  LinkConstraints,
  RawFile,
  ValidateOptions,
  ValidationResult,
  ValidationSummary,
  VaultIndex,
  VaultIndexEntry,
  VaultSchema,
} from "./types";
import { countResult, validateFile } from "./validate";
import { isInFolder, isInSkippedDir, isOutsideVault, isSchemaFile, isValidationTarget, templateFolders, TEMPLATE_SETTINGS } from "./vault-files";
import { assertSafeVaultPath } from "./vault-path";

// --- Reading ---

async function readNote(app: App, file: TFile): Promise<RawFile> {
  return { path: file.path, content: await app.vault.cachedRead(file) };
}

/** Vault paths of the entities/ and properties/ folders. */
export function schemaFolders(schemaDir: string): { entities: string; properties: string } {
  const base = normalizeSchemaDir(schemaDir);
  const join = (name: string) => (base ? `${base}/${name}` : name);
  return { entities: join("entities"), properties: join("properties") };
}

/** True when a vault path is inside the schema folders. */
export function isInSchemaFolders(path: string, schemaDir: string): boolean {
  const { entities, properties } = schemaFolders(schemaDir);
  return path.startsWith(`${entities}/`) || path.startsWith(`${properties}/`);
}

function schemaFilesIn(app: App, folderPath: string): TFile[] {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return [];
  const files: TFile[] = [];
  const visit = (f: TFolder) => {
    for (const child of f.children) {
      if (child instanceof TFolder) visit(child);
      else if (child instanceof TFile && isSchemaFile(child.path.slice(folderPath.length + 1))) files.push(child);
    }
  };
  visit(folder);
  return files;
}

/** Load the schema from the vault's entity and property notes. */
export async function loadSchemaFromVault(app: App, schemaDir: string): Promise<VaultSchema> {
  const { entities, properties } = schemaFolders(schemaDir);
  const [entityFiles, propertyFiles] = await Promise.all(
    [entities, properties].map((folder) => Promise.all(schemaFilesIn(app, folder).map((f) => readNote(app, f)))),
  );
  return loadSchema(entityFiles, propertyFiles);
}

/** The vault's template folders, from the Templates and Templater settings. */
export async function readTemplateFolders(app: App): Promise<string[]> {
  const texts = new Map<string, string>();
  for (const { file } of TEMPLATE_SETTINGS) {
    try {
      texts.set(file, await app.vault.adapter.read(`${app.vault.configDir}/${file}`));
    } catch {}
  }
  return templateFolders((file) => texts.get(file));
}

/** True for a note the plugin validates: what the CLI walk would pick. */
export function isNoteToValidate(path: string, templates: readonly string[]): boolean {
  return isValidationTarget(path) && !isInSkippedDir(path) && !isInFolder(path, templates);
}

/** True when validation needs the link index: body links are checked, or
 * some property has link constraints. */
export function needsLinkIndex(schema: VaultSchema, checkLinks: boolean): boolean {
  return checkLinks || schema.properties.some((p) => p.link_constraints);
}

/** The vault's link index, kept up to date one file at a time. */
export class LinkIndexCache {
  private entries: Map<string, VaultIndexEntry> | null = null;
  private index: VaultIndex | null = null;

  constructor(private readonly app: App) {}

  private isIndexed(file: TAbstractFile): file is TFile {
    return file instanceof TFile && !isOutsideVault(file.path);
  }

  private async readEntry(file: TFile): Promise<VaultIndexEntry> {
    let data: Record<string, unknown> = {};
    if (file.extension === "md") {
      try {
        data = parseFrontmatter(await this.app.vault.cachedRead(file)).data;
      } catch {
        // Broken YAML: still a link target, with no frontmatter.
      }
    }
    return { path: file.path, data };
  }

  async get(): Promise<VaultIndex> {
    if (!this.entries) {
      const files = this.app.vault.getFiles().filter((f) => this.isIndexed(f));
      const entries = await Promise.all(files.map((f) => this.readEntry(f)));
      this.entries = new Map(entries.map((e) => [e.path, e]));
      this.index = null;
    }
    return (this.index ??= buildIndexFromEntries([...this.entries.values()]));
  }

  /** A file was created or modified. */
  async update(file: TAbstractFile): Promise<void> {
    if (!this.entries || !this.isIndexed(file)) return;
    this.entries.set(file.path, await this.readEntry(file));
    this.index = null;
  }

  /** A file was deleted, or renamed away from `path`. */
  remove(path: string): void {
    if (this.entries?.delete(path)) this.index = null;
  }
}

/** Validate one note. */
export async function validateNote(app: App, file: TFile, schema: VaultSchema, options: ValidateOptions): Promise<ValidationResult> {
  return validateFile(await readNote(app, file), schema, options);
}

/** Validate every note the CLI would validate; every result is kept. */
export async function validateVaultNotes(app: App, schema: VaultSchema, options: ValidateOptions): Promise<ValidationSummary> {
  const summary: ValidationSummary = { total: 0, valid: 0, invalid: 0, skipped: 0, results: [] };
  const templates = await readTemplateFolders(app);
  const files = app.vault.getMarkdownFiles().filter((f) => isNoteToValidate(f.path, templates));
  for (const note of await Promise.all(files.map((f) => readNote(app, f)))) {
    const result = validateFile(note, schema, options);
    countResult(summary, result);
    summary.results.push(result);
  }
  return summary;
}

// --- Writing schema notes ---

/** Fields the Entities tab edits. */
export type EntityFields = {
  name: string;
  allow_extra: boolean;
  extends?: string;
  expected_folder?: string;
  /** Property name → whether the UI shows it as required */
  properties: Record<string, { required?: boolean }>;
};

/** Fields the Properties tab edits. */
export type PropertyFields = {
  name: string;
  property_type: string;
  allowed_values?: (string | number)[];
  min_value?: number;
  max_value?: number;
  unit?: string;
  nullable?: boolean;
  custom_validator?: string;
  link_constraints?: LinkConstraints;
};

export function schemaFilePath(schemaDir: string, kind: "entity" | "property", name: string): string {
  const { entities, properties } = schemaFolders(schemaDir);
  return kind === "entity" ? `${entities}/${name}_entity.md` : `${properties}/${name}_property.md`;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

/** Edit a note's frontmatter in place, creating the note if needed. The body
 * and every key the update does not touch are kept. */
async function editFrontmatter(app: App, path: string, update: (fm: Record<string, unknown>) => void): Promise<void> {
  assertSafeVaultPath(path);
  let file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    await ensureFolder(app, path.split("/").slice(0, -1).join("/"));
    file = await app.vault.create(path, "");
  }
  await app.fileManager.processFrontMatter(file as TFile, update);
}

/** Set a key, or delete it when the value is empty. */
function setOrDelete(fm: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === "" || value === false) delete fm[key];
  else fm[key] = value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Write an entity note from the Entities tab. Each property keeps the rest of
 * its config (e.g. `required_unless`); only its required flag is updated. */
export async function saveEntity(app: App, path: string, fields: EntityFields): Promise<void> {
  await editFrontmatter(app, path, (fm) => {
    const previous = asRecord(fm.properties);
    fm.entity_name = fields.name;
    setOrDelete(fm, "extends", fields.extends);
    setOrDelete(fm, "allow_extra", fields.allow_extra);
    setOrDelete(fm, "expected_folder", fields.expected_folder);
    fm.properties = Object.fromEntries(
      Object.entries(fields.properties).map(([name, { required }]) => {
        const config = { ...asRecord(previous[name]) } as EntityPropertyConfig;
        const conditional = config.required_unless != null;
        // With required_unless, required is implied; `required: false` turns it off.
        if (required) {
          if (conditional) delete config.required;
          else config.required = true;
        } else if (conditional) config.required = false;
        else delete config.required;
        return [name, config];
      }),
    );
  });
}

/** Write a property note from the Properties tab. Keys the tab does not edit
 * (e.g. `etl`, a description) are kept. */
export async function saveProperty(app: App, path: string, fields: PropertyFields): Promise<void> {
  await editFrontmatter(app, path, (fm) => {
    fm.property_name = fields.name;
    fm.property_type = fields.property_type;
    setOrDelete(fm, "allowed_values", fields.allowed_values?.length ? fields.allowed_values : undefined);
    setOrDelete(fm, "min_value", fields.min_value);
    setOrDelete(fm, "max_value", fields.max_value);
    setOrDelete(fm, "unit", fields.unit);
    setOrDelete(fm, "nullable", fields.nullable);
    setOrDelete(fm, "custom_validator", fields.custom_validator);
    const lc = fields.link_constraints ?? {};
    setOrDelete(fm, "target_type_key", lc.target_type_key);
    setOrDelete(fm, "target_folder", lc.target_folder);
    setOrDelete(fm, "target_has_property", lc.target_has_property);
    setOrDelete(fm, "target_property_value", lc.target_property_value);
  });
}

/** Move a schema note into a `_deprecated/` folder next to it, which takes it
 * out of the schema. */
export async function archiveSchemaFile(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  const folder = file.parent?.path && file.parent.path !== "/" ? `${file.parent.path}/_deprecated` : "_deprecated";
  await ensureFolder(app, folder);
  await app.vault.rename(file, `${folder}/${file.name}`);
}
