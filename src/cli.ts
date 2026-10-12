#!/usr/bin/env bun
import { program } from "commander";
import { readFile, stat } from "fs/promises";
import { join, relative } from "path";
import { loadSchema, detectTypeKeyField } from "./schema.js";
import { validateFile } from "./validate.js";
import { frontmatterBlock, parseFrontmatter } from "./frontmatter.js";
import { resolveConfig } from "./config.js";
import { buildIndexFromEntries } from "./link-index.js";
import { walkMdFiles, walkLinkableFiles, walkSchemaFiles } from "./walk.js";
import type {
  RawFile,
  ValidateOptions,
  VaultIndex,
  VaultSchema,
  ValidationResult,
  ValidationSummary,
} from "./types.js";

/** Read all schema .md files into memory (small number of files; skips `_deprecated/`) */
async function readMdFiles(dir: string): Promise<RawFile[]> {
  const paths = await walkSchemaFiles(dir);
  const files: RawFile[] = [];
  for (const path of paths) {
    files.push({ path, content: await readFile(path, "utf-8") });
  }
  return files;
}

/** Read a file's frontmatter block only — the body is not needed without --check-links */
async function readFrontmatterOnly(path: string): Promise<string> {
  return frontmatterBlock(await readFile(path, "utf-8"));
}

/** Validate files one at a time — only frontmatter in memory */
async function validateStreaming(
  paths: string[],
  schema: VaultSchema,
  typeFilter?: string,
  validateOpts?: ValidateOptions,
): Promise<ValidationSummary> {
  const results: ValidationResult[] = [];
  let valid = 0;
  let invalid = 0;
  let skipped = 0;

  for (const path of paths) {
    const content = validateOpts?.checkLinks
      ? await readFile(path, "utf-8")
      : await readFrontmatterOnly(path);
    const result = validateFile({ path, content }, schema, validateOpts);

    if (typeFilter && result.entityType !== typeFilter) continue;

    if (result.entityType === null && result.valid) {
      skipped++;
    } else if (result.valid) {
      valid++;
    } else {
      invalid++;
    }

    // Only keep results with issues
    if (result.errors.length > 0 || result.warnings.length > 0) {
      results.push(result);
    }
  }

  return {
    total: valid + invalid + skipped,
    valid,
    invalid,
    skipped,
    results,
  };
}

function formatPretty(summary: ValidationSummary, baseDir: string): string {
  const lines: string[] = [];

  for (const result of summary.results) {
    const relPath = relative(baseDir, result.file);
    const tag = result.valid ? "WARN" : "FAIL";
    lines.push(`\n${tag} ${relPath} [${result.entityType ?? "?"}]`);

    for (const err of result.errors) {
      lines.push(`  ✗ ${err.field}: ${err.message}`);
    }
    for (const warn of result.warnings) {
      lines.push(`  ⚠ ${warn.field}: ${warn.message}`);
    }
  }

  lines.push("");
  lines.push(
    `Total: ${summary.total} | Valid: ${summary.valid} | Invalid: ${summary.invalid} | Skipped: ${summary.skipped}`,
  );

  return lines.join("\n");
}

/** Load the two-tier schema (entities/ + properties/) from a schema dir. */
async function loadSchemaFromDir(schemaDir: string): Promise<VaultSchema> {
  const [entityFiles, propertyFiles] = await Promise.all([
    readMdFiles(join(schemaDir, "entities")),
    readMdFiles(join(schemaDir, "properties")),
  ]);
  return loadSchema(entityFiles, propertyFiles);
}

program
  .command("mdbase-export")
  .description("generate mdbase.yaml + _types/*.md (JSON Schema 2020-12) from the entity/property notes")
  .option("--schema-dir <path>", "path to schema files")
  .option("--out <dir>", "output directory (default: a fresh temp dir)")
  .option("--type-key-field <name>", "frontmatter field that identifies entity type (auto-detected from schema; falls back to 'entity')")
  .action(async (options) => {
    try {
      const { exportMdbase } = await import("./mdbase/export.js");
      const { mkdtemp } = await import("fs/promises");
      const { tmpdir } = await import("os");
      // Commander recognises root options (--schema-dir, --type-key-field) even when
      // they follow the subcommand name, so they land on program.opts(), not here.
      const root = program.opts();
      const config = resolveConfig({ schema_dir: options.schemaDir ?? root.schemaDir });
      const schema = await loadSchemaFromDir(config.schema_dir);
      const typeKeyField =
        options.typeKeyField ?? root.typeKeyField ?? config.type_key_field ?? detectTypeKeyField(schema) ?? "entity";
      const outDir = options.out ?? (await mkdtemp(join(tmpdir(), "obsi-validate-mdbase-")));
      const written = await exportMdbase(schema, typeKeyField, outDir);
      console.log(`${outDir}\n  ${written.length} files (${written.length - 1} types, type key: ${typeKeyField})`);
    } catch (err) {
      console.error(`obsi-validate: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .name("obsi-validate")
  .description("Validate Obsidian vault frontmatter against schema")
  .argument("[path]", "file or directory to validate")
  .option("--schema-dir <path>", "path to schema files")
  .option("--vault-dir <path>", "vault root to validate")
  .option("-f, --format <type>", "output format: pretty | json", "pretty")
  .option("-t, --type <entity>", "filter by entity type")
  .option("--type-key-field <name>", "frontmatter field that identifies entity type (auto-detected from schema; falls back to 'entity')")
  .option("--check-links", "validate body wikilinks and inline properties")
  .option("--engine <name>", "shape-validation engine: mdbase | zod", "mdbase")
  .option(
    "--exclude <dir>",
    "directory basename to skip in both walks (repeatable); additive with config exclude_dirs",
    (val: string, prev: string[]) => prev.concat([val]),
    [] as string[],
  )
  .action(async (path, options) => {
   try {
    const config = resolveConfig({
      schema_dir: options.schemaDir,
      vault_dir: path ?? options.vaultDir,
      exclude_dirs: options.exclude,
    });
    const schemaDir = config.schema_dir;
    const vaultDir = config.vault_dir;
    const excludeDirs: ReadonlySet<string> = new Set(config.exclude_dirs);

    // Load schema (small — ~120 files, bulk read is fine)
    const schema = await loadSchemaFromDir(schemaDir);

    // Resolve type_key field: CLI flag > config > schema auto-detect > "entity" fallback
    const typeKeyField =
      options.typeKeyField ??
      config.type_key_field ??
      detectTypeKeyField(schema) ??
      "entity";

    const validateOpts: ValidateOptions = {
      typeKeyField,
      defaultEntityType: config.default_type || undefined,
      checkLinks: options.checkLinks ?? false,
      vaultRoot: options.vaultDir ?? ((await stat(vaultDir)).isDirectory() ? vaultDir : undefined),
    };
    if (options.engine === "mdbase") {
      // Loaded on demand: keeps mdbase out of the plugin bundle (the plugin stays on Zod).
      const { mdbaseShapeEngine } = await import("./mdbase/adapter.js");
      validateOpts.shapeEngine = mdbaseShapeEngine(schema, typeKeyField);
    } else if (options.engine !== "zod") {
      throw new Error(`unknown --engine "${options.engine}" (expected zod | mdbase)`);
    }

    // Single file or directory
    const targetStat = await stat(vaultDir);

    // Build vault index when check-links is enabled
    if (options.checkLinks) {
      // The index covers the whole vault (--vault-dir), not just the target, so
      // links from the target to notes elsewhere resolve.
      const vaultRoot = options.vaultDir ?? vaultDir;
      const allPaths = await walkLinkableFiles(vaultRoot, excludeDirs);
      const entries: Array<{ path: string; data: Record<string, unknown> }> = [];
      for (const p of allPaths) {
        let data: Record<string, unknown> = {};
        if (!p.endsWith(".canvas")) {
          try {
            data = parseFrontmatter(await readFrontmatterOnly(p)).data;
          } catch {}
        }
        // Vault-relative, like the plugin's TFile.path — folder rules match on it.
        entries.push({ path: relative(vaultRoot, p), data });
      }
      const vaultIndex: VaultIndex = buildIndexFromEntries(entries);
      validateOpts.vaultIndex = vaultIndex;
    }
    const targetPaths = targetStat.isFile()
      ? [vaultDir]
      : await walkMdFiles(vaultDir, excludeDirs);
    const summary = await validateStreaming(targetPaths, schema, options.type, validateOpts);

    // Output
    if (options.format === "json") {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(formatPretty(summary, vaultDir));
    }

    process.exit(summary.invalid > 0 ? 1 : 0);
   } catch (err) {
     console.error(`obsi-validate: ${err instanceof Error ? err.message : String(err)}`);
     process.exit(1);
   }
  });

program.parse();
