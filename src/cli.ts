#!/usr/bin/env bun
import { program } from "commander";
import { readFileSync } from "fs";
import { readFile, stat } from "fs/promises";
import { isAbsolute, join, relative } from "path";
import { resolveConfig, type Config } from "./config.js";
import { frontmatterBlock, parseFrontmatter } from "./frontmatter.js";
import { buildIndexFromEntries } from "./link-index.js";
import { loadSchema, resolveTypeKeyField } from "./schema.js";
import type { RawFile, ValidateOptions, ValidationSummary, VaultIndex, VaultIndexEntry, VaultSchema } from "./types.js";
import { countResult, emptySummary, validateFile } from "./validate.js";
import { fieldLabel } from "./values.js";
import { templateFolders } from "./vault-files.js";
import { walkSchemaFiles, walkValidationTargets, walkVaultFiles } from "./walk.js";

async function readSchemaFiles(dir: string): Promise<RawFile[]> {
  const paths = await walkSchemaFiles(dir);
  return Promise.all(paths.map(async (path) => ({ path, content: await readFile(path, "utf-8") })));
}

/** Load the schema from a folder holding entities/ and properties/. */
async function loadSchemaFromDir(schemaDir: string): Promise<VaultSchema> {
  const [entityFiles, propertyFiles] = await Promise.all([
    readSchemaFiles(join(schemaDir, "entities")),
    readSchemaFiles(join(schemaDir, "properties")),
  ]);
  return loadSchema(entityFiles, propertyFiles);
}

async function readFrontmatterOnly(path: string): Promise<string> {
  return frontmatterBlock(await readFile(path, "utf-8"));
}

/** Link index over the whole vault (not just the target), so links to notes elsewhere resolve. */
async function buildLinkIndex(config: Config): Promise<VaultIndex> {
  const entries: VaultIndexEntry[] = [];
  for (const path of await walkVaultFiles(config.vault_dir, new Set(config.exclude_dirs))) {
    let data: Record<string, unknown> = {};
    if (path.endsWith(".md")) {
      try {
        data = parseFrontmatter(await readFrontmatterOnly(path)).data;
      } catch {}
    }
    entries.push({ path: relative(config.vault_dir, path), data });
  }
  return buildIndexFromEntries(entries);
}

/** The vault's template folders, relative to `root`. */
function templateFoldersUnder(config: Config, root: string): string[] {
  const read = (file: string) => {
    try {
      return readFileSync(join(config.vault_dir, ".obsidian", file), "utf-8");
    } catch {
      return undefined;
    }
  };
  return templateFolders(read).map((folder) => relative(root, join(config.vault_dir, folder)));
}

/** Validate files one at a time, keeping only results with errors or warnings. */
async function validatePaths(paths: string[], schema: VaultSchema, options: ValidateOptions, typeFilter?: string): Promise<ValidationSummary> {
  const summary = emptySummary();
  for (const path of paths) {
    const content = options.checkLinks ? await readFile(path, "utf-8") : await readFrontmatterOnly(path);
    const result = validateFile({ path, content }, schema, options);
    if (typeFilter && result.entityType !== typeFilter) continue;
    countResult(summary, result);
    if (result.errors.length > 0 || result.warnings.length > 0) summary.results.push(result);
  }
  return summary;
}

function formatPretty(summary: ValidationSummary, vaultDir: string): string {
  const shown = (file: string) => {
    const rel = relative(vaultDir, file);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : file;
  };
  const lines: string[] = [];
  for (const result of [...summary.results].sort((a, b) => a.file.localeCompare(b.file))) {
    lines.push(`\n${result.valid ? "WARN" : "FAIL"} ${shown(result.file)} [${result.entityType ?? "?"}]`);
    for (const e of result.errors) lines.push(`  ✗ ${fieldLabel(e.field).label}: ${e.message}`);
    for (const w of result.warnings) lines.push(`  ⚠ ${fieldLabel(w.field).label}: ${w.message}`);
  }
  lines.push("", `Total: ${summary.total} | Valid: ${summary.valid} | Invalid: ${summary.invalid} | Skipped: ${summary.skipped}`);
  return lines.join("\n");
}

function fail(err: unknown): never {
  console.error(`obsi-validate: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const TYPE_KEY_HELP = "frontmatter field naming a note's type (default: config, else 'type_key' if the schema declares it, else 'entity')";

program
  .command("mdbase-export")
  .description("write mdbase.yaml + _types/*.md (JSON Schema 2020-12) generated from the entity/property notes")
  .option("--schema-dir <path>", "folder with entities/ and properties/")
  .option("--out <dir>", "output folder (default: a new temp folder)")
  .option("--type-key-field <name>", TYPE_KEY_HELP)
  .action(async (options) => {
    try {
      const { exportMdbase } = await import("./mdbase/export.js");
      const { mkdtemp } = await import("fs/promises");
      const { tmpdir } = await import("os");
      // Root options given after the subcommand name land on program.opts().
      const root = program.opts();
      const config = resolveConfig({ schema_dir: options.schemaDir ?? root.schemaDir });
      const schema = await loadSchemaFromDir(config.schema_dir);
      const typeKeyField = resolveTypeKeyField(schema, options.typeKeyField ?? root.typeKeyField ?? config.type_key_field);
      const outDir = options.out ?? (await mkdtemp(join(tmpdir(), "obsi-validate-mdbase-")));
      const written = await exportMdbase(schema, typeKeyField, outDir);
      console.log(`${outDir}\n  ${written.length} files (${written.length - 1} types, type key: ${typeKeyField})`);
    } catch (err) {
      fail(err);
    }
  });

program
  .name("obsi-validate")
  .description("Validate Obsidian vault frontmatter against the vault's entity/property schema")
  .argument("[path]", "file or folder to validate (default: the vault)")
  .option("--schema-dir <path>", "folder with entities/ and properties/ (default: <vault>/_system or config schema_dir)")
  .option("--vault-dir <path>", "vault root for the link index and folder rules (default: the nearest folder above [path] with _system/entities, else config vault_dir)")
  .option("-f, --format <type>", "output format: pretty | json", "pretty")
  .option("-t, --type <entity>", "report only notes of this type")
  .option("--type-key-field <name>", TYPE_KEY_HELP)
  .option("--check-links", "check link constraints (target_*), body wikilinks and inline properties")
  .option("--strict-links", "with --check-links: broken body wikilinks and inline properties are errors, not warnings")
  .option("--engine <name>", "shape-validation engine: mdbase | zod", "mdbase")
  .option(
    "--exclude <dir>",
    "folder name to skip, repeatable; added to config exclude_dirs",
    (val: string, prev: string[]) => prev.concat([val]),
    [] as string[],
  )
  .action(async (path, options) => {
    try {
      const config = resolveConfig({
        target: path,
        vault_dir: options.vaultDir,
        schema_dir: options.schemaDir,
        type_key_field: options.typeKeyField,
        exclude_dirs: options.exclude,
      });
      const schema = await loadSchemaFromDir(config.schema_dir);
      const typeKeyField = resolveTypeKeyField(schema, config.type_key_field);

      const validateOptions: ValidateOptions = {
        typeKeyField,
        defaultEntityType: config.default_type || undefined,
        checkLinks: Boolean(options.checkLinks),
        strictLinks: Boolean(options.strictLinks),
        vaultRoot: config.vault_dir,
      };
      if (options.engine === "mdbase") {
        // Loaded on demand: the plugin bundle never includes mdbase.
        const { mdbaseShapeEngine } = await import("./mdbase/adapter.js");
        validateOptions.shapeEngine = mdbaseShapeEngine(schema, typeKeyField);
      } else if (options.engine !== "zod") {
        throw new Error(`unknown --engine "${options.engine}" (expected mdbase | zod)`);
      }
      if (validateOptions.checkLinks) validateOptions.vaultIndex = await buildLinkIndex(config);

      const paths = (await stat(config.target)).isFile()
        ? [config.target]
        : await walkValidationTargets(config.target, new Set(config.exclude_dirs), templateFoldersUnder(config, config.target));
      const summary = await validatePaths(paths, schema, validateOptions, options.type);

      console.log(options.format === "json" ? JSON.stringify(summary, null, 2) : formatPretty(summary, config.vault_dir));
      process.exit(summary.invalid > 0 ? 1 : 0);
    } catch (err) {
      fail(err);
    }
  });

program.parse();
