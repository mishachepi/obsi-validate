export const VIEW_TYPE_RESULTS = "obsi-validate-results";

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
