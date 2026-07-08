#!/usr/bin/env bun
import { program } from "commander";
import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";
import { loadSchema, detectTypeKeyField } from "./schema.js";
import { validateFile } from "./validate.js";
import { resolveConfig } from "./config.js";
import type {
  RawFile,
  ValidateOptions,
  VaultIndex,
  VaultSchema,
  ValidationResult,
  ValidationSummary,
} from "./types.js";

/** Walk directory recursively, skipping dot-directories */
async function walkMdFiles(dir: string): Promise<string[]> {
  const paths: string[] = [];

  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      // Skip archive / shadow-override trees: their duplicate-basename notes
      // would shadow canonical notes in the link index (first-wins).
      if (entry.isDirectory() && (entry.name === "_archive" || entry.name === "_skill")) continue;
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_index.md") {
        paths.push(fullPath);
      }
    }
  }

  await walk(dir);
  return paths;
}

/** Read all .md files into memory (for schema — small number of files) */
async function readMdFiles(dir: string): Promise<RawFile[]> {
  const paths = await walkMdFiles(dir);
  const files: RawFile[] = [];
  for (const path of paths) {
    files.push({ path, content: await readFile(path, "utf-8") });
  }
  return files;
}

/** Extract frontmatter prefix from a file — only this part is passed to gray-matter */
async function readFrontmatterOnly(path: string): Promise<string> {
  const content = await readFile(path, "utf-8");
  const firstSep = content.indexOf("---");
  if (firstSep === -1) return "";
  const secondSep = content.indexOf("---", firstSep + 3);
  if (secondSep === -1) return "";
  return content.slice(0, secondSep + 3);
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
  .action(async (path, options) => {
   try {
    const config = resolveConfig({
      schema_dir: options.schemaDir,
      vault_dir: path ?? options.vaultDir,
    });
    const schemaDir = config.schema_dir;
    const vaultDir = config.vault_dir;

    // Load schema (small — ~120 files, bulk read is fine)
    const [entityFiles, propertyFiles] = await Promise.all([
      readMdFiles(join(schemaDir, "entities")),
      readMdFiles(join(schemaDir, "properties")),
    ]);
    const schema = loadSchema(entityFiles, propertyFiles);

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
    };

    // Single file or directory
    const targetStat = await stat(vaultDir);

    // Build vault index when check-links is enabled
    if (options.checkLinks) {
      const matter = (await import("gray-matter")).default;
      // Vault index must cover the WHOLE vault for cross-folder link resolution.
      // Always prefer --vault-dir; only fall back to the target when no flag given.
      // (Previously, validating a directory indexed only that dir → every link to a
      //  note outside it, e.g. all Areas from _core, was a false "not found".)
      const vaultRoot = options.vaultDir ?? vaultDir;
      const allPaths = await walkMdFiles(vaultRoot);
      const vaultIndex: VaultIndex = new Map();
      for (const p of allPaths) {
        const fm = await readFrontmatterOnly(p);
        let data: Record<string, unknown> = {};
        try {
          data = matter(fm).data;
        } catch {}
        const basename = p.split("/").pop()!.replace(/\.md$/, "");
        vaultIndex.set(basename, { path: p, data });
      }
      validateOpts.vaultIndex = vaultIndex;
    }
    const targetPaths = targetStat.isFile()
      ? [vaultDir]
      : await walkMdFiles(vaultDir);
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
