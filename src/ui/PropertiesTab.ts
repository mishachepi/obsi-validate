import { Modal, App, Notice, Setting } from "obsidian";
import type ObsiValidatePlugin from "../plugin-main";
import {
  ensureSchema,
  writePropertyFile,
  deprecateSchemaFile,
  propertyFilePath,
} from "../bridge";

/** Validate a schema name (entity or property) */
export function isValidSchemaName(name: string): string | null {
  if (!name) return "Name is required";
  if (name.length > 100) return "Name too long (max 100)";
  if (/[\/\\:*?"<>|]/.test(name)) return "Name contains invalid characters";
  if (name.startsWith(".") || name.startsWith("_")) return "Name cannot start with . or _";
  return null;
}

/** Check custom validator expression syntax without executing it.
 * Uses Function constructor solely for syntax checking — the expression comes from
 * the vault owner's own schema files (same trust context as vault content). */
function checkValidatorSyntax(expr: string): string | null {
  if (!expr) return null;
  try {
    // Syntax check only — the function is never called
    void Function("value", `return (${expr})`);
    return null;
  } catch (e) {
    return `Syntax error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const PROPERTY_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "time",
  "datetime",
  "enum",
  "link",
  "wikilink",
  "list",
  "emoji",
];

export async function renderPropertiesTab(
  containerEl: HTMLElement,
  plugin: ObsiValidatePlugin,
): Promise<void> {
  const schema = await ensureSchema(
    plugin.app,
    plugin.settings.schemaDir,
    plugin.schema,
  );
  plugin.schema = schema;

  // Header with New button
  const header = containerEl.createDiv({ cls: "obsi-validate-tab-header" });
  header.createEl("h3", { text: "Properties" });
  const newBtn = header.createEl("button", {
    text: "New Property",
    cls: "obsi-validate-new-btn",
  });

  const listEl = containerEl.createDiv({ cls: "obsi-validate-schema-list" });

  if (schema.properties.length === 0) {
    listEl.createEl("p", {
      text: "No properties defined. Create one to get started.",
      cls: "obsi-validate-placeholder",
    });
  }

  // Group properties by folder
  const grouped = new Map<string, typeof schema.properties>();
  for (const prop of schema.properties) {
    const folder = prop.folder ?? "";
    if (!grouped.has(folder)) grouped.set(folder, []);
    grouped.get(folder)!.push(prop);
  }

  // Sort: root first, then alphabetical folders
  const folders = [...grouped.keys()].sort((a, b) => {
    if (!a) return -1;
    if (!b) return 1;
    return a.localeCompare(b);
  });

  for (const folder of folders) {
    if (folder) {
      listEl.createEl("h4", {
        text: folder,
        cls: "obsi-validate-folder-heading",
      });
    }
    for (const prop of grouped.get(folder)!) {
      renderPropertyItem(listEl, prop, schema, plugin);
    }
  }

  newBtn.addEventListener("click", () => {
    renderNewPropertyForm(containerEl, listEl, schema, plugin);
  });
}

function renderPropertyItem(
  containerEl: HTMLElement,
  prop: { name: string; property_type: string; allowed_values?: (string | number)[]; min_value?: number; max_value?: number; unit?: string; custom_validator?: string; folder?: string; link_constraints?: { target_type_key?: string; target_folder?: string; target_has_property?: string; target_property_value?: { property: string; value: string } } },
  schema: { entities: { name: string }[] },
  plugin: ObsiValidatePlugin,
): void {
  const details = containerEl.createEl("details", {
    cls: "obsi-validate-schema-item",
  });

  const summary = details.createEl("summary");
  summary.createSpan({ text: prop.name, cls: "obsi-validate-item-name" });
  if (prop.folder) {
    summary.createSpan({
      text: prop.folder,
      cls: "obsi-validate-folder-badge",
    });
  }
  summary.createSpan({
    text: prop.property_type,
    cls: "obsi-validate-type-badge",
  });

  const content = details.createDiv({ cls: "obsi-validate-item-content" });

  // Mutable state
  let currentType = prop.property_type;
  let allowedValues = prop.allowed_values ? [...prop.allowed_values.map(String)] : [];
  let minValue = prop.min_value;
  let maxValue = prop.max_value;
  let unit = prop.unit;
  let customValidator = prop.custom_validator ?? "";
  let linkConstraints = prop.link_constraints ? { ...prop.link_constraints } : {
    target_type_key: undefined as string | undefined,
    target_folder: undefined as string | undefined,
    target_has_property: undefined as string | undefined,
    target_property_value: undefined as { property: string; value: string } | undefined,
  };

  // Type dropdown
  new Setting(content).setName("Type").addDropdown((dd) => {
    for (const t of PROPERTY_TYPES) {
      dd.addOption(t, t);
    }
    dd.setValue(currentType);
    dd.onChange((val) => {
      currentType = val;
      renderConstraints();
    });
  });

  // Constraints container
  const constraintsEl = content.createDiv({ cls: "obsi-validate-constraints" });

  function renderConstraints() {
    constraintsEl.empty();

    if (currentType === "enum") {
      renderEnumEditor(constraintsEl, allowedValues, (vals) => {
        allowedValues = vals;
      });
    } else if (currentType === "number") {
      new Setting(constraintsEl).setName("Min value").addText((text) =>
        text
          .setValue(minValue != null ? String(minValue) : "")
          .setPlaceholder("none")
          .onChange((val) => {
            minValue = val ? Number(val) : undefined;
          }),
      );
      new Setting(constraintsEl).setName("Max value").addText((text) =>
        text
          .setValue(maxValue != null ? String(maxValue) : "")
          .setPlaceholder("none")
          .onChange((val) => {
            maxValue = val ? Number(val) : undefined;
          }),
      );
      new Setting(constraintsEl).setName("Unit").addText((text) =>
        text
          .setValue(unit ?? "")
          .setPlaceholder("optional")
          .onChange((val) => {
            unit = val || undefined;
          }),
      );
    }

    // Link constraints for link/wikilink/list types
    if (currentType === "link" || currentType === "wikilink" || currentType === "list") {
      renderLinkConstraintsEditor(constraintsEl, linkConstraints, schema, (lc) => {
        linkConstraints = lc;
      });
    }
  }

  renderConstraints();

  // Custom validator
  new Setting(content)
    .setName("Custom validator")
    .setDesc('JS expression. Gets "value". Return false or error string to fail. E.g: typeof value === "string" && value.length > 0')
    .addTextArea((text) =>
      text
        .setValue(customValidator)
        .setPlaceholder('typeof value === "string" && value.length > 0')
        .onChange((val) => {
          customValidator = val;
        }),
    );

  // Action bar
  const actions = content.createDiv({ cls: "obsi-validate-action-bar" });
  const saveBtn = actions.createEl("button", {
    text: "Save",
    cls: "mod-cta",
  });
  const archiveBtn = actions.createEl("button", {
    text: "Archive",
    cls: "mod-warning",
  });

  saveBtn.addEventListener("click", async () => {
    const syntaxErr = checkValidatorSyntax(customValidator);
    if (syntaxErr) {
      new Notice(`Custom validator ${syntaxErr}`);
      return;
    }
    saveBtn.disabled = true;
    try {
      const hasLinkConstraints = (currentType === "link" || currentType === "wikilink" || currentType === "list") &&
        (linkConstraints.target_type_key || linkConstraints.target_folder || linkConstraints.target_has_property || linkConstraints.target_property_value);
      await writePropertyFile(plugin.app, plugin.settings.schemaDir, prop.name, currentType, {
        allowed_values: currentType === "enum" ? allowedValues : undefined,
        min_value: currentType === "number" ? minValue : undefined,
        max_value: currentType === "number" ? maxValue : undefined,
        unit: currentType === "number" ? unit : undefined,
        custom_validator: customValidator || undefined,
        link_constraints: hasLinkConstraints ? linkConstraints : undefined,
      });
      plugin.schema = null;
      new Notice(`Property "${prop.name}" saved.`);
      const tabEl = containerEl.parentElement;
      if (tabEl) {
        tabEl.empty();
        await renderPropertiesTab(tabEl, plugin);
      }
    } catch (e) {
      new Notice(`Failed to save: ${e}`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  archiveBtn.addEventListener("click", () => {
    new ConfirmArchiveModal(plugin.app, "property", prop.name, async () => {
      const path = propertyFilePath(plugin.settings.schemaDir, prop.name);
      try {
        await deprecateSchemaFile(plugin.app, path);
        plugin.schema = null;
        new Notice(`Property "${prop.name}" archived.`);
        details.remove();
      } catch (e) {
        new Notice(`Failed to archive: ${e}`);
      }
    }).open();
  });
}

function renderLinkConstraintsEditor(
  containerEl: HTMLElement,
  constraints: { target_type_key?: string; target_folder?: string; target_has_property?: string; target_property_value?: { property: string; value: string } },
  schema: { entities: { name: string }[] },
  onChange: (lc: typeof constraints) => void,
): void {
  const label = containerEl.createDiv({ cls: "setting-item-name" });
  label.setText("Link constraints");
  const desc = containerEl.createDiv({ cls: "setting-item-description" });
  desc.setText("Validate what the linked notes must satisfy");

  // Target entity — dropdown from entity names
  new Setting(containerEl)
    .setName("Target entity")
    .setDesc("Linked note must have this entity type")
    .addDropdown((dd) => {
      dd.addOption("", "(any)");
      for (const e of schema.entities) {
        dd.addOption(e.name, e.name);
      }
      dd.setValue(constraints.target_type_key ?? "");
      dd.onChange((val) => {
        constraints.target_type_key = val || undefined;
        onChange(constraints);
      });
    });

  // Target folder
  new Setting(containerEl)
    .setName("Target folder")
    .setDesc("Linked note must be in this folder (prefix match)")
    .addText((text) =>
      text
        .setValue(constraints.target_folder ?? "")
        .setPlaceholder("e.g. Areas/")
        .onChange((val) => {
          constraints.target_folder = val || undefined;
          onChange(constraints);
        }),
    );

  // Target has property
  new Setting(containerEl)
    .setName("Target has property")
    .setDesc("Linked note must have this property defined")
    .addText((text) =>
      text
        .setValue(constraints.target_has_property ?? "")
        .setPlaceholder("e.g. status")
        .onChange((val) => {
          constraints.target_has_property = val || undefined;
          onChange(constraints);
        }),
    );

  // Target property value
  const pvRow = containerEl.createDiv({ cls: "obsi-validate-pv-row" });
  pvRow.createDiv({ cls: "setting-item-name" }).setText("Target property value");
  pvRow.createDiv({ cls: "setting-item-description" }).setText("Linked note's property must equal this value");
  const pvInputs = pvRow.createDiv({ cls: "obsi-validate-pv-inputs" });
  const pvPropInput = pvInputs.createEl("input", {
    type: "text",
    placeholder: "property",
    value: constraints.target_property_value?.property ?? "",
  });
  pvInputs.createSpan({ text: " = " });
  const pvValInput = pvInputs.createEl("input", {
    type: "text",
    placeholder: "value",
    value: constraints.target_property_value?.value ?? "",
  });
  const updatePV = () => {
    const prop = pvPropInput.value.trim();
    const val = pvValInput.value.trim();
    constraints.target_property_value = prop && val ? { property: prop, value: val } : undefined;
    onChange(constraints);
  };
  pvPropInput.addEventListener("change", updatePV);
  pvValInput.addEventListener("change", updatePV);
}

function renderEnumEditor(
  containerEl: HTMLElement,
  values: string[],
  onChange: (vals: string[]) => void,
): void {
  const label = containerEl.createDiv({ cls: "setting-item-name" });
  label.setText("Allowed values");

  const listEl = containerEl.createDiv({ cls: "obsi-validate-enum-values" });

  function renderList() {
    listEl.empty();
    for (let i = 0; i < values.length; i++) {
      const row = listEl.createDiv({ cls: "obsi-validate-enum-row" });
      const input = row.createEl("input", {
        type: "text",
        value: values[i],
        cls: "obsi-validate-enum-input",
      });
      input.addEventListener("change", () => {
        values[i] = input.value;
        onChange(values);
      });
      const removeBtn = row.createEl("button", {
        text: "\u00D7",
        cls: "obsi-validate-enum-remove",
      });
      removeBtn.addEventListener("click", () => {
        values.splice(i, 1);
        onChange(values);
        renderList();
      });
    }
  }

  renderList();

  const addBtn = containerEl.createEl("button", {
    text: "+ Add value",
    cls: "obsi-validate-add-btn",
  });
  addBtn.addEventListener("click", () => {
    values.push("");
    onChange(values);
    renderList();
    // Focus the new input
    const inputs = listEl.querySelectorAll("input");
    if (inputs.length > 0) {
      (inputs[inputs.length - 1] as HTMLInputElement).focus();
    }
  });
}

function renderNewPropertyForm(
  tabContentEl: HTMLElement,
  listEl: HTMLElement,
  schema: { entities: { name: string }[] },
  plugin: ObsiValidatePlugin,
): void {
  // Check if form already exists
  const existing = tabContentEl.querySelector(".obsi-validate-new-form");
  if (existing) {
    (existing as HTMLElement).querySelector("input")?.focus();
    return;
  }

  const form = tabContentEl.createDiv({ cls: "obsi-validate-new-form" });
  // Insert before the list
  tabContentEl.insertBefore(form, listEl);

  form.createEl("h4", { text: "New Property" });

  let name = "";
  let type = "string";
  let allowedValues: string[] = [];
  let minValue: number | undefined;
  let maxValue: number | undefined;
  let customValidator = "";
  let newLinkConstraints: { target_type_key?: string; target_folder?: string; target_has_property?: string; target_property_value?: { property: string; value: string } } = {};

  new Setting(form).setName("Name").addText((text) =>
    text.setPlaceholder("e.g. status").onChange((val) => {
      name = val.trim().toLowerCase().replace(/\s+/g, "_");
    }),
  );

  const constraintsEl = form.createDiv({ cls: "obsi-validate-constraints" });

  new Setting(form).setName("Type").addDropdown((dd) => {
    for (const t of PROPERTY_TYPES) {
      dd.addOption(t, t);
    }
    dd.setValue(type);
    dd.onChange((val) => {
      type = val;
      renderNewConstraints();
    });
  });
  // Move constraints after type dropdown
  form.appendChild(constraintsEl);

  function renderNewConstraints() {
    constraintsEl.empty();
    if (type === "enum") {
      renderEnumEditor(constraintsEl, allowedValues, (vals) => {
        allowedValues = vals;
      });
    } else if (type === "number") {
      new Setting(constraintsEl).setName("Min value").addText((text) =>
        text.setPlaceholder("none").onChange((val) => {
          minValue = val ? Number(val) : undefined;
        }),
      );
      new Setting(constraintsEl).setName("Max value").addText((text) =>
        text.setPlaceholder("none").onChange((val) => {
          maxValue = val ? Number(val) : undefined;
        }),
      );
    }

    if (type === "link" || type === "wikilink" || type === "list") {
      renderLinkConstraintsEditor(constraintsEl, newLinkConstraints, schema, (lc) => {
        newLinkConstraints = lc;
      });
    }
  }

  new Setting(form)
    .setName("Custom validator")
    .setDesc('JS expression. Gets "value". Return false or error string to fail.')
    .addTextArea((text) =>
      text
        .setPlaceholder('typeof value === "string" && value.length > 0')
        .onChange((val) => {
          customValidator = val;
        }),
    );

  const actions = form.createDiv({ cls: "obsi-validate-action-bar" });
  const createBtn = actions.createEl("button", {
    text: "Create",
    cls: "mod-cta",
  });
  const cancelBtn = actions.createEl("button", { text: "Cancel" });

  createBtn.addEventListener("click", async () => {
    const nameErr = isValidSchemaName(name);
    if (nameErr) {
      new Notice(nameErr);
      return;
    }
    const syntaxErr = checkValidatorSyntax(customValidator);
    if (syntaxErr) {
      new Notice(`Custom validator ${syntaxErr}`);
      return;
    }
    createBtn.disabled = true;
    try {
      const hasLC = (type === "link" || type === "wikilink" || type === "list") &&
        (newLinkConstraints.target_type_key || newLinkConstraints.target_folder || newLinkConstraints.target_has_property || newLinkConstraints.target_property_value);
      await writePropertyFile(plugin.app, plugin.settings.schemaDir, name, type, {
        allowed_values: type === "enum" ? allowedValues : undefined,
        min_value: type === "number" ? minValue : undefined,
        max_value: type === "number" ? maxValue : undefined,
        custom_validator: customValidator || undefined,
        link_constraints: hasLC ? newLinkConstraints : undefined,
      });
      plugin.schema = null;
      new Notice(`Property "${name}" created.`);
      form.remove();
      // Re-render list
      const parent = listEl.parentElement!;
      parent.empty();
      await renderPropertiesTab(parent, plugin);
    } catch (e) {
      new Notice(`Failed to create: ${e}`);
      createBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener("click", () => {
    form.remove();
  });
}

/** Confirmation modal for archiving schema files */
export class ConfirmArchiveModal extends Modal {
  private kind: string;
  private name: string;
  private onConfirm: () => void;

  constructor(app: App, kind: string, name: string, onConfirm: () => void) {
    super(app);
    this.kind = kind;
    this.name = name;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: `Archive ${this.kind}` });
    contentEl.createEl("p", {
      text: `Are you sure you want to archive "${this.name}"? The file will be moved to the _deprecated/ directory.`,
    });

    const actions = contentEl.createDiv({ cls: "obsi-validate-action-bar" });
    const confirmBtn = actions.createEl("button", {
      text: "Archive",
      cls: "mod-warning",
    });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });

    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
