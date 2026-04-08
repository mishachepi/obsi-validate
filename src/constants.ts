export const VIEW_TYPE_RESULTS = "property-validator-results";

export interface PluginSettings {
  schemaDir: string;
  typeKeyField: string;
  showRibbonIcon: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  schemaDir: ".",
  typeKeyField: "type_key",
  showRibbonIcon: false,
};
