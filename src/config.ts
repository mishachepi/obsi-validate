import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { DEFAULT_ENTITY_FIELD } from "./constants.js";

export type Config = {
  schema_dir: string;
  vault_dir: string;
  type_key_field: string;
  default_type: string;
};

const DEFAULTS: Config = {
  schema_dir: "./vault",
  vault_dir: ".",
  type_key_field: DEFAULT_ENTITY_FIELD,
  default_type: "",
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
    type_key_field:
      file.type_key_field ??
      DEFAULTS.type_key_field,
    default_type:
      file.default_type ??
      DEFAULTS.default_type,
  };
}

