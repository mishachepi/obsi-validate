import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type Config = {
  schema_dir: string;
  vault_dir: string;
};

const DEFAULTS: Config = {
  schema_dir: "./vault",
  vault_dir: ".",
};

const CONFIG_PATH = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "obsi-validate",
  "config.json",
);

function loadConfigFile(): Partial<Config> {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Resolve config: CLI flags > env vars > config file > defaults */
export function resolveConfig(flags: Partial<Config>): Config {
  const file = loadConfigFile();

  return {
    schema_dir:
      flags.schema_dir ??
      process.env.SCHEMA_DIR ??
      file.schema_dir ??
      DEFAULTS.schema_dir,
    vault_dir:
      flags.vault_dir ??
      process.env.VAULT_DIR ??
      file.vault_dir ??
      DEFAULTS.vault_dir,
  };
}

export { CONFIG_PATH };
