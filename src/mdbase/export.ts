/** Write the generated mdbase collection files to disk (CLI only; the
 * translation itself in translate.ts is runtime-agnostic). */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { VaultSchema } from "../types.js";
import { renderConfigFile, renderTypeFile, translateSchema } from "./translate.js";

/** Write `mdbase.yaml` + `_types/*.md` into `outDir`. Returns written paths (relative). */
export async function exportMdbase(
  schema: VaultSchema,
  typeKeyField: string,
  outDir: string,
): Promise<string[]> {
  const { config, types } = translateSchema(schema, typeKeyField);
  await mkdir(join(outDir, config.settings.types_folder), { recursive: true });
  const written: string[] = [];

  await writeFile(join(outDir, "mdbase.yaml"), renderConfigFile(config), "utf-8");
  written.push("mdbase.yaml");
  for (const def of types) {
    const rel = join(config.settings.types_folder, `${def.name}.md`);
    await writeFile(join(outDir, rel), renderTypeFile(def), "utf-8");
    written.push(rel);
  }
  return written;
}
