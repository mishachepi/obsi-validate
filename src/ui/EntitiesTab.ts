import { Notice, Setting } from "obsidian";
import type ObsiValidatePlugin from "../plugin-main";
import type { VaultSchema, ResolvedProperty } from "../types";
import {
  ensureSchema,
  writeEntityFile,
  deprecateSchemaFile,
  entityFilePath,
} from "../bridge";
import { ConfirmArchiveModal, isValidSchemaName, filterSchemaList } from "./PropertiesTab";

/** Render an editable property list into containerEl */
function renderEditablePropList(
  containerEl: HTMLElement,
  properties: Record<string, { required?: boolean }>,
  onChanged?: () => void,
): void {
  containerEl.empty();
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    containerEl.createEl("p", {
      text: "No own properties. Add one below.",
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
      onChanged?.();
    });

    const removeBtn = row.createEl("button", {
      text: "\u00D7",
      cls: "obsi-validate-enum-remove",
    });
    removeBtn.addEventListener("click", () => {
      delete properties[propName];
      onChanged?.();
      renderEditablePropList(containerEl, properties, onChanged);
    });
  }
}

/** Render inherited properties as read-only, grouped by source entity */
function renderInheritedProps(
  containerEl: HTMLElement,
  entityName: string,
  schema: VaultSchema,
): void {
  const resolved = schema.entityMap.get(entityName);
  if (!resolved) return;

  // Group inherited props by source
  const inherited = new Map<string, ResolvedProperty[]>();
  for (const prop of resolved) {
    if (prop.inheritedFrom) {
      if (!inherited.has(prop.inheritedFrom)) inherited.set(prop.inheritedFrom, []);
      inherited.get(prop.inheritedFrom)!.push(prop);
    }
  }

  if (inherited.size === 0) return;

  for (const [source, props] of inherited) {
    const section = containerEl.createDiv({ cls: "obsi-validate-inherited-section" });
    section.createDiv({
      text: `Inherited from ${source}`,
      cls: "obsi-validate-inherited-label",
    });
    for (const prop of props) {
      const row = section.createDiv({ cls: "obsi-validate-prop-row obsi-validate-inherited-row" });
      row.createSpan({ text: prop.name, cls: "obsi-validate-prop-name" });
      if (prop.required) {
        row.createSpan({ text: "required", cls: "obsi-validate-req-badge" });
      }
    }
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

  // Search
  const searchInput = containerEl.createEl("input", {
    type: "text",
    placeholder: "Search entities...",
    cls: "obsi-validate-search",
  });
  searchInput.addEventListener("input", () => {
    filterSchemaList(searchInput.value, listEl);
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
      renderEntityItem(listEl, entity, allPropertyNames, schema, plugin);
    }
  }

  newBtn.addEventListener("click", () => {
    renderNewEntityForm(containerEl, listEl, allPropertyNames, schema, plugin);
  });
}

function renderEntityItem(
  containerEl: HTMLElement,
  entity: { name: string; properties: Record<string, { required?: boolean }>; extends?: string; allow_extra?: boolean; folder?: string; sourcePath?: string },
  allPropertyNames: string[],
  schema: VaultSchema,
  plugin: ObsiValidatePlugin,
): void {
  const details = containerEl.createEl("details", {
    cls: "obsi-validate-schema-item",
  });
  details.dataset.name = entity.name;

  // Count own vs inherited
  const resolved = schema.entityMap.get(entity.name) ?? [];
  const ownCount = Object.keys(entity.properties).length;
  const inheritedCount = resolved.filter((p) => p.inheritedFrom).length;
  const totalCount = ownCount + inheritedCount;

  const summary = details.createEl("summary");
  summary.createSpan({ text: entity.name, cls: "obsi-validate-item-name" });
  if (entity.folder) {
    summary.createSpan({ text: entity.folder, cls: "obsi-validate-folder-badge" });
  }
  if (entity.extends) {
    summary.createSpan({ text: `\u2190 ${entity.extends}`, cls: "obsi-validate-extends-badge" });
  }
  summary.createSpan({
    text: inheritedCount > 0 ? `${ownCount}+${inheritedCount} props` : `${totalCount} props`,
    cls: "obsi-validate-type-badge",
  });
  if (entity.allow_extra) {
    summary.createSpan({ text: "allow_extra", cls: "obsi-validate-extra-badge" });
  }

  const content = details.createDiv({ cls: "obsi-validate-item-content" });

  // Mutable state
  let allowExtra = entity.allow_extra ?? false;
  let extendsEntity = entity.extends ?? "";
  const properties: Record<string, { required?: boolean }> = {};
  for (const [k, v] of Object.entries(entity.properties)) {
    properties[k] = { required: v.required };
  }

  // Auto-save helper (debounced)
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const autoSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await writeEntityFile(
          plugin.app,
          plugin.settings.schemaDir,
          entity.name,
          allowExtra,
          properties,
          extendsEntity || undefined,
          entity.sourcePath,
        );
        plugin.schema = null; plugin.schemaLoading = null;
      } catch (e) {
        new Notice(`Failed to save: ${e}`);
      }
    }, 500);
  };

  // Extends dropdown
  new Setting(content)
    .setName("Extends")
    .setDesc("Inherit properties from a parent entity")
    .addDropdown((dd) => {
      dd.addOption("", "(none)");
      for (const e of schema.entities) {
        if (e.name !== entity.name) {
          dd.addOption(e.name, e.name);
        }
      }
      dd.setValue(extendsEntity);
      dd.onChange((val) => {
        extendsEntity = val;
        autoSave();
      });
    });

  // Allow extra toggle
  new Setting(content)
    .setName("Allow extra fields")
    .setDesc("Don't warn about unknown properties in this entity type")
    .addToggle((toggle) =>
      toggle.setValue(allowExtra).onChange((val) => {
        allowExtra = val;
        autoSave();
      }),
    );

  // Own properties
  const ownLabel = content.createDiv({ cls: "setting-item-name" });
  ownLabel.setText("Own properties");

  const propsListEl = content.createDiv({ cls: "obsi-validate-prop-list" });
  renderEditablePropList(propsListEl, properties, autoSave);

  // Add property
  const addRow = content.createDiv({ cls: "obsi-validate-add-prop-row" });
  const selectEl = addRow.createEl("select", { cls: "obsi-validate-prop-select" });
  selectEl.createEl("option", { value: "", text: "Select property..." });
  for (const pName of allPropertyNames) {
    selectEl.createEl("option", { value: pName, text: pName });
  }
  const freeInput = addRow.createEl("input", {
    type: "text",
    placeholder: "or type name",
    cls: "obsi-validate-free-input",
  });
  const addBtn = addRow.createEl("button", { text: "Add", cls: "obsi-validate-add-btn" });
  addBtn.addEventListener("click", () => {
    const name = selectEl.value || freeInput.value.trim().replace(/\s+/g, "_");
    if (!name) return;
    if (name in properties) {
      new Notice(`Property "${name}" already added.`);
      return;
    }
    properties[name] = {};
    selectEl.value = "";
    freeInput.value = "";
    autoSave();
    renderEditablePropList(propsListEl, properties, autoSave);
  });

  // Inherited properties (read-only)
  const inheritedEl = content.createDiv({ cls: "obsi-validate-inherited" });
  renderInheritedProps(inheritedEl, entity.name, schema);

  // Action bar
  const actions = content.createDiv({ cls: "obsi-validate-action-bar" });

  if (entity.sourcePath) {
    const openBtn = actions.createEl("button", { text: "Open file" });
    openBtn.addEventListener("click", () => {
      const file = plugin.app.vault.getAbstractFileByPath(entity.sourcePath!);
      if (file) plugin.app.workspace.getLeaf().openFile(file as import("obsidian").TFile);
    });
  }

  const archiveBtn = actions.createEl("button", { text: "Archive", cls: "mod-warning" });

  archiveBtn.addEventListener("click", () => {
    new ConfirmArchiveModal(plugin.app, "entity", entity.name, async () => {
      const path = entity.sourcePath ?? entityFilePath(plugin.settings.schemaDir, entity.name);
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
  schema: VaultSchema,
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
  let extendsEntity = "";
  const properties: Record<string, { required?: boolean }> = {};

  new Setting(form).setName("Name").setDesc("Entity type name (e.g. task, note, book)").addText(
    (text) =>
      text.setPlaceholder("e.g. task").onChange((val) => {
        name = val.trim().toLowerCase().replace(/\s+/g, "_");
      }),
  );

  new Setting(form)
    .setName("Extends")
    .setDesc("Inherit properties from a parent entity")
    .addDropdown((dd) => {
      dd.addOption("", "(none)");
      for (const e of schema.entities) {
        dd.addOption(e.name, e.name);
      }
      dd.onChange((val) => {
        extendsEntity = val;
      });
    });

  new Setting(form)
    .setName("Allow extra fields")
    .addToggle((toggle) =>
      toggle.setValue(allowExtra).onChange((val) => {
        allowExtra = val;
      }),
    );

  // Properties
  const propsLabel = form.createDiv({ cls: "setting-item-name" });
  propsLabel.setText("Own properties");

  const propsListEl = form.createDiv({ cls: "obsi-validate-prop-list" });

  const addRow = form.createDiv({ cls: "obsi-validate-add-prop-row" });
  const selectEl = addRow.createEl("select", { cls: "obsi-validate-prop-select" });
  selectEl.createEl("option", { value: "", text: "Select property..." });
  for (const pName of allPropertyNames) {
    selectEl.createEl("option", { value: pName, text: pName });
  }
  const freeInput = addRow.createEl("input", {
    type: "text",
    placeholder: "or type name",
    cls: "obsi-validate-free-input",
  });
  const addBtn = addRow.createEl("button", { text: "Add", cls: "obsi-validate-add-btn" });
  addBtn.addEventListener("click", () => {
    const pName = selectEl.value || freeInput.value.trim().replace(/\s+/g, "_");
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
  const createBtn = actions.createEl("button", { text: "Create", cls: "mod-cta" });
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
        extendsEntity || undefined,
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
