import { Notice, Setting } from "obsidian";
import type ObsiValidatePlugin from "../main";
import {
  ensureSchema,
  writeEntityFile,
  deprecateSchemaFile,
  entityFilePath,
} from "../bridge";
import { ConfirmArchiveModal, isValidSchemaName } from "./PropertiesTab";

/** Render an editable property list into containerEl */
function renderEditablePropList(
  containerEl: HTMLElement,
  properties: Record<string, { required?: boolean }>,
): void {
  containerEl.empty();
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    containerEl.createEl("p", {
      text: "No properties. Add one below.",
      cls: "obsi-validate-placeholder",
    });
    return;
  }
  for (const [propName, config] of entries) {
    const row = containerEl.createDiv({ cls: "obsi-validate-prop-row" });
    row.createSpan({ text: propName, cls: "obsi-validate-prop-name" });

    const reqLabel = row.createEl("label", { cls: "obsi-validate-req-label" });
    const reqCheckbox = reqLabel.createEl("input", { type: "checkbox" });
    reqCheckbox.checked = config.required ?? false;
    reqLabel.createSpan({ text: " required" });
    reqCheckbox.addEventListener("change", () => {
      properties[propName] = { required: reqCheckbox.checked || undefined };
    });

    const removeBtn = row.createEl("button", {
      text: "\u00D7",
      cls: "obsi-validate-enum-remove",
    });
    removeBtn.addEventListener("click", () => {
      delete properties[propName];
      renderEditablePropList(containerEl, properties);
    });
  }
}

export async function renderEntitiesTab(
  containerEl: HTMLElement,
  plugin: ObsiValidatePlugin,
): Promise<void> {
  const schema = await ensureSchema(
    plugin.app,
    plugin.settings.schemaDir,
    plugin.schema,
  );
  plugin.schema = schema;

  const allPropertyNames = schema.properties.map((p) => p.name);

  // Header
  const header = containerEl.createDiv({ cls: "obsi-validate-tab-header" });
  header.createEl("h3", { text: "Entities" });
  const newBtn = header.createEl("button", {
    text: "New Entity",
    cls: "obsi-validate-new-btn",
  });

  const listEl = containerEl.createDiv({ cls: "obsi-validate-schema-list" });

  if (schema.entities.length === 0) {
    listEl.createEl("p", {
      text: "No entities defined. Create one to get started.",
      cls: "obsi-validate-placeholder",
    });
  }

  // Group entities by folder
  const grouped = new Map<string, typeof schema.entities>();
  for (const entity of schema.entities) {
    const folder = entity.folder ?? "";
    if (!grouped.has(folder)) grouped.set(folder, []);
    grouped.get(folder)!.push(entity);
  }

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
    for (const entity of grouped.get(folder)!) {
      renderEntityItem(listEl, entity, allPropertyNames, plugin);
    }
  }

  newBtn.addEventListener("click", () => {
    renderNewEntityForm(containerEl, listEl, allPropertyNames, plugin);
  });
}

function renderEntityItem(
  containerEl: HTMLElement,
  entity: { name: string; properties: Record<string, { required?: boolean }>; allow_extra?: boolean; folder?: string },
  allPropertyNames: string[],
  plugin: ObsiValidatePlugin,
): void {
  const details = containerEl.createEl("details", {
    cls: "obsi-validate-schema-item",
  });

  const summary = details.createEl("summary");
  summary.createSpan({ text: entity.name, cls: "obsi-validate-item-name" });
  if (entity.folder) {
    summary.createSpan({
      text: entity.folder,
      cls: "obsi-validate-folder-badge",
    });
  }
  const propCount = Object.keys(entity.properties).length;
  summary.createSpan({
    text: `${propCount} props`,
    cls: "obsi-validate-type-badge",
  });
  if (entity.allow_extra) {
    summary.createSpan({
      text: "allow_extra",
      cls: "obsi-validate-extra-badge",
    });
  }

  const content = details.createDiv({ cls: "obsi-validate-item-content" });

  // Mutable state
  let allowExtra = entity.allow_extra ?? false;
  const properties: Record<string, { required?: boolean }> = {};
  for (const [k, v] of Object.entries(entity.properties)) {
    properties[k] = { required: v.required };
  }

  // Allow extra toggle
  new Setting(content)
    .setName("Allow extra fields")
    .setDesc("Don't warn about unknown properties in this entity type")
    .addToggle((toggle) =>
      toggle.setValue(allowExtra).onChange((val) => {
        allowExtra = val;
      }),
    );

  // Properties list
  const propsLabel = content.createDiv({ cls: "setting-item-name" });
  propsLabel.setText("Properties");

  const propsListEl = content.createDiv({ cls: "obsi-validate-prop-list" });
  renderEditablePropList(propsListEl, properties);

  // Add property
  const addRow = content.createDiv({ cls: "obsi-validate-add-prop-row" });
  const selectEl = addRow.createEl("select", {
    cls: "obsi-validate-prop-select",
  });
  selectEl.createEl("option", { value: "", text: "Select property..." });
  for (const pName of allPropertyNames) {
    selectEl.createEl("option", { value: pName, text: pName });
  }
  // Also allow free text
  const freeInput = addRow.createEl("input", {
    type: "text",
    placeholder: "or type name",
    cls: "obsi-validate-free-input",
  });
  const addBtn = addRow.createEl("button", {
    text: "Add",
    cls: "obsi-validate-add-btn",
  });
  addBtn.addEventListener("click", () => {
    const name = selectEl.value || freeInput.value.trim().toLowerCase().replace(/\s+/g, "_");
    if (!name) return;
    if (name in properties) {
      new Notice(`Property "${name}" already added.`);
      return;
    }
    properties[name] = {};
    selectEl.value = "";
    freeInput.value = "";
    renderEditablePropList(propsListEl, properties);
  });

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
    saveBtn.disabled = true;
    try {
      await writeEntityFile(
        plugin.app,
        plugin.settings.schemaDir,
        entity.name,
        allowExtra,
        properties,
      );
      plugin.schema = null;
      new Notice(`Entity "${entity.name}" saved.`);
      const tabEl = containerEl.parentElement;
      if (tabEl) {
        tabEl.empty();
        await renderEntitiesTab(tabEl, plugin);
      }
    } catch (e) {
      new Notice(`Failed to save: ${e}`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  archiveBtn.addEventListener("click", () => {
    new ConfirmArchiveModal(plugin.app, "entity", entity.name, async () => {
      const path = entityFilePath(plugin.settings.schemaDir, entity.name);
      try {
        await deprecateSchemaFile(plugin.app, path);
        plugin.schema = null;
        new Notice(`Entity "${entity.name}" archived.`);
        details.remove();
      } catch (e) {
        new Notice(`Failed to archive: ${e}`);
      }
    }).open();
  });
}

function renderNewEntityForm(
  tabContentEl: HTMLElement,
  listEl: HTMLElement,
  allPropertyNames: string[],
  plugin: ObsiValidatePlugin,
): void {
  const existing = tabContentEl.querySelector(".obsi-validate-new-form");
  if (existing) {
    (existing as HTMLElement).querySelector("input")?.focus();
    return;
  }

  const form = tabContentEl.createDiv({ cls: "obsi-validate-new-form" });
  tabContentEl.insertBefore(form, listEl);

  form.createEl("h4", { text: "New Entity" });

  let name = "";
  let allowExtra = false;
  const properties: Record<string, { required?: boolean }> = {};

  new Setting(form).setName("Name").setDesc("Entity type name (e.g. task, note, book)").addText(
    (text) =>
      text.setPlaceholder("e.g. task").onChange((val) => {
        name = val.trim().toLowerCase().replace(/\s+/g, "_");
      }),
  );

  new Setting(form)
    .setName("Allow extra fields")
    .addToggle((toggle) =>
      toggle.setValue(allowExtra).onChange((val) => {
        allowExtra = val;
      }),
    );

  // Property adder
  const propsLabel = form.createDiv({ cls: "setting-item-name" });
  propsLabel.setText("Properties");

  const propsListEl = form.createDiv({ cls: "obsi-validate-prop-list" });

  const addRow = form.createDiv({ cls: "obsi-validate-add-prop-row" });
  const selectEl = addRow.createEl("select", {
    cls: "obsi-validate-prop-select",
  });
  selectEl.createEl("option", { value: "", text: "Select property..." });
  for (const pName of allPropertyNames) {
    selectEl.createEl("option", { value: pName, text: pName });
  }
  const freeInput = addRow.createEl("input", {
    type: "text",
    placeholder: "or type name",
    cls: "obsi-validate-free-input",
  });
  const addBtn = addRow.createEl("button", {
    text: "Add",
    cls: "obsi-validate-add-btn",
  });
  addBtn.addEventListener("click", () => {
    const pName =
      selectEl.value || freeInput.value.trim().toLowerCase().replace(/\s+/g, "_");
    if (!pName) return;
    if (pName in properties) {
      new Notice(`Property "${pName}" already added.`);
      return;
    }
    properties[pName] = {};
    selectEl.value = "";
    freeInput.value = "";
    renderEditablePropList(propsListEl, properties);
  });

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
    createBtn.disabled = true;
    try {
      await writeEntityFile(
        plugin.app,
        plugin.settings.schemaDir,
        name,
        allowExtra,
        properties,
      );
      plugin.schema = null;
      new Notice(`Entity "${name}" created.`);
      form.remove();
      const parent = listEl.parentElement!;
      parent.empty();
      await renderEntitiesTab(parent, plugin);
    } catch (e) {
      new Notice(`Failed to create: ${e}`);
      createBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener("click", () => {
    form.remove();
  });
}
