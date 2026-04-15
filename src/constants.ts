export const VIEW_TYPE_RESULTS = "property-validator-results";
export const VIEW_TYPE_VAULT_RESULTS = "property-validator-vault-results";
export const DEFAULT_ENTITY_FIELD = "entity";

export interface PluginSettings {
  schemaDir: string;
  typeKeyField: string;
  defaultEntityType: string;
  showRibbonIcon: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  schemaDir: ".",
  typeKeyField: DEFAULT_ENTITY_FIELD,
  defaultEntityType: "",
  showRibbonIcon: false,
};
