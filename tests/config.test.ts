import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveConfig } from "../src/config.js";

async function configFileAt(data: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "obsi-validate-config-"));
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(data));
  return path;
}

describe("resolveConfig — exclude_dirs is additive, not override", () => {
  test("config file alone", async () => {
    const path = await configFileAt({ exclude_dirs: ["from-file"] });
    const config = resolveConfig({}, path);
    expect(config.exclude_dirs).toEqual(["from-file"]);
  });

  test("CLI --exclude layers on top of the config file, does not replace it", async () => {
    const path = await configFileAt({ exclude_dirs: ["from-file"] });
    const config = resolveConfig({ exclude_dirs: ["from-cli"] }, path);
    expect(config.exclude_dirs).toEqual(["from-file", "from-cli"]);
  });

  test("no config file on disk falls back to an empty list, not a crash", () => {
    const config = resolveConfig({}, join(tmpdir(), "does-not-exist-config.json"));
    expect(config.exclude_dirs).toEqual([]);
  });

  test("CLI --exclude still comes through with no config file present", () => {
    const config = resolveConfig(
      { exclude_dirs: ["from-cli-only"] },
      join(tmpdir(), "does-not-exist-config.json"),
    );
    expect(config.exclude_dirs).toEqual(["from-cli-only"]);
  });

  test("config file with no exclude_dirs key still yields an empty list, not undefined", async () => {
    const path = await configFileAt({ vault_dir: "." });
    const config = resolveConfig({}, path);
    expect(config.exclude_dirs).toEqual([]);
  });
});
