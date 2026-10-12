/** Obsidian plugin settings and view ids. */

export const VIEW_TYPE_RESULTS = "property-validator-results";
export const VIEW_TYPE_VAULT_RESULTS = "property-validator-vault-results";

export interface PluginSettings {
  /** Folder with entities/ and properties/, relative to the vault root */
  schemaDir: string;
  /** Frontmatter field naming a note's type; empty = detect from the schema */
  typeKeyField: string;
  /** Type for notes without a type field; empty = skip them */
  defaultEntityType: string;
  /** Also check wikilinks and inline properties in the note body */
  checkLinks: boolean;
  showRibbonIcon: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  schemaDir: ".",
  typeKeyField: "",
  defaultEntityType: "",
  checkLinks: true,
  showRibbonIcon: false,
};

/** Schema folder without trailing slashes; "." and "" mean the vault root. */
export function normalizeSchemaDir(dir: string): string {
  const trimmed = dir.trim().replace(/[/\\]+$/, "");
  return trimmed === "." ? "" : trimmed;
}
