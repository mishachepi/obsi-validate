/** CLI configuration. Explicit beats inferred: flags, then environment, then
 * the vault found above an explicitly given path, then the config file, then
 * the vault found above the current folder. */
import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";

export type Config = {
  /** File or folder to validate */
  target: string;
  /** Vault root: link index, folder rules and relative paths are based on it */
  vault_dir: string;
  /** Folder with entities/ and properties/ */
  schema_dir: string;
  /** Frontmatter type field; undefined = detect from the schema */
  type_key_field?: string;
  /** Type for notes without a type field; "" = skip them */
  default_type: string;
  /** Folder names skipped in every walk, on top of dot-folders, `_archive` and `_skill` */
  exclude_dirs: string[];
};

export type ConfigFlags = Partial<Omit<Config, "default_type">>;

const SCHEMA_FOLDER = "_system";

/** Path of the config file: $XDG_CONFIG_HOME/obsi-validate/config.json, else ~/.config/…. */
export const CONFIG_PATH = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "obsi-validate", "config.json");

/** The nearest folder at or above `start` that holds `_system/entities`. */
function findVaultRoot(start: string): string | undefined {
  let dir = resolve(start);
  if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);
  for (;;) {
    if (existsSync(join(dir, SCHEMA_FOLDER, "entities"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function folderOf(path: string): string {
  return existsSync(path) && statSync(path).isFile() ? dirname(path) : path;
}

/** An environment variable; empty counts as unset. */
function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

function readConfigFile(path: string): Partial<Config> {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/** Resolve the configuration; `target` and `vault_dir` come back absolute.
 * `configPath` exists for tests. */
export function resolveConfig(flags: ConfigFlags, configPath: string = CONFIG_PATH): Config {
  const file = readConfigFile(configPath);
  const explicitStart = flags.target ?? flags.vault_dir;
  const fromTarget = explicitStart ? findVaultRoot(explicitStart) : undefined;
  const fromCwd = explicitStart ? undefined : findVaultRoot(".");

  const vault_dir = resolve(
    flags.vault_dir ?? env("VAULT_DIR") ?? fromTarget ?? file.vault_dir ?? fromCwd ?? folderOf(explicitStart ?? "."),
  );
  const schema_dir =
    flags.schema_dir ??
    env("SCHEMA_DIR") ??
    (fromTarget && join(fromTarget, SCHEMA_FOLDER)) ??
    file.schema_dir ??
    join(vault_dir, SCHEMA_FOLDER);

  return {
    target: flags.target ? resolve(flags.target) : vault_dir,
    vault_dir,
    schema_dir,
    type_key_field: flags.type_key_field ?? file.type_key_field,
    default_type: file.default_type ?? "",
    // --exclude adds to the config-file list instead of replacing it.
    exclude_dirs: [...(file.exclude_dirs ?? []), ...(flags.exclude_dirs ?? [])],
  };
}
