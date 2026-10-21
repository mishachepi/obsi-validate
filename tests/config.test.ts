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

describe("resolveConfig — target and vault root", () => {
  const none = join(tmpdir(), "does-not-exist-config.json");
  const fixture = join(import.meta.dir, "fixtures", "mini-vault");

  test("the vault root is discovered from the target", () => {
    const config = resolveConfig({ target: join(fixture, "tasks", "good.md") }, none);
    expect(config.vault_dir).toBe(fixture);
    expect(config.schema_dir).toBe(join(fixture, "_system"));
    expect(config.target).toBe(join(fixture, "tasks", "good.md"));
  });

  test("an explicit vault dir beats discovery", () => {
    const config = resolveConfig({ target: join(fixture, "tasks"), vault_dir: join(fixture, "tasks") }, none);
    expect(config.vault_dir).toBe(join(fixture, "tasks"));
  });

  test("the vault found above an explicit target beats the config file", async () => {
    const path = await configFileAt({ vault_dir: "/somewhere", schema_dir: "/somewhere/_system" });
    const config = resolveConfig({ target: join(fixture, "tasks") }, path);
    expect(config.vault_dir).toBe(fixture);
    expect(config.schema_dir).toBe(join(fixture, "_system"));
  });

  test("without a target, the config file names the vault", async () => {
    const path = await configFileAt({ vault_dir: "/somewhere" });
    expect(resolveConfig({}, path).vault_dir).toBe("/somewhere");
  });

  test("without a target, the vault itself is the target", () => {
    const config = resolveConfig({ vault_dir: fixture }, none);
    expect(config.target).toBe(fixture);
  });
});
