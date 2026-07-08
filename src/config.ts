import { readFileSync, existsSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";

export type Config = {
  schema_dir: string;
  vault_dir: string;
  /** Frontmatter field for entity type — undefined means caller should auto-detect */
  type_key_field?: string;
  default_type: string;
};

const DEFAULTS = {
  schema_dir: "./_system",
  vault_dir: ".",
  default_type: "",
};

/** Walk up from a start path (file or dir) to the vault root — the nearest
 *  ancestor holding `_system/entities` — and return its `_system` schema dir.
 *  Lets the CLI find schemas from any cwd without an explicit --schema-dir. */
function discoverSchemaDir(start: string): string | undefined {
  try {
    let dir = resolve(start || ".");
    if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);
    for (;;) {
      const candidate = join(dir, "_system");
      if (existsSync(join(candidate, "entities"))) return candidate;
      const parent = dirname(dir);
      if (parent === dir) return undefined; // reached filesystem root
      dir = parent;
    }
  } catch {
    return undefined;
  }
}

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

  const vault_dir =
    flags.vault_dir ??
    process.env.VAULT_DIR ??
    file.vault_dir ??
    DEFAULTS.vault_dir;

  const schema_dir =
    flags.schema_dir ??
    process.env.SCHEMA_DIR ??
    file.schema_dir ??
    discoverSchemaDir(vault_dir) ??
    DEFAULTS.schema_dir;

  return {
    schema_dir,
    vault_dir,
    type_key_field: flags.type_key_field ?? file.type_key_field,
    default_type:
      file.default_type ??
      DEFAULTS.default_type,
  };
}

