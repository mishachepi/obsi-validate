export const VIEW_TYPE_RESULTS = "property-validator-results";

/**
 * Task-intake detector cutoff (user ratification 2026-08-17, intake model §2;
 * date agreed with orchestrator 2026-08-17): tasks with `created` >= this
 * moment must follow the obsi-tasks creation canon (ISO created with time,
 * created_by, non-empty epic). Earlier tasks are grandfathered — history is
 * not rewritten. Timezone pinned to the vault owner's local offset so the
 * cutoff means local midnight, not UTC.
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
