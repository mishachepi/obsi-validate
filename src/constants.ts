export const VIEW_TYPE_RESULTS = "property-validator-results";

/**
 * Task-intake detector cutoff: tasks with `created` at or after this moment
 * must have been created by the capture tool (see validateTaskIntake); older
 * tasks are exempt. The offset pins it to local midnight, not UTC.
 */
export const TASK_INTAKE_CUTOFF = new Date("2026-08-18T00:00:00+02:00");
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
