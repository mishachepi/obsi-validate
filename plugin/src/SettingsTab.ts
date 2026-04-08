import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsiValidatePlugin from "./main";
import { TabManager } from "./ui/TabManager";
import { renderEntitiesTab } from "./ui/EntitiesTab";
import { renderPropertiesTab } from "./ui/PropertiesTab";

export class ObsiValidateSettingTab extends PluginSettingTab {
  plugin: ObsiValidatePlugin;

  constructor(app: App, plugin: ObsiValidatePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const tabs = new TabManager(containerEl, [
      {
        id: "settings",
        label: "Settings",
        render: (el) => this.renderSettings(el),
      },
      {
        id: "entities",
        label: "Entities",
        render: (el) => renderEntitiesTab(el, this.plugin),
      },
      {
        id: "properties",
        label: "Properties",
        render: (el) => renderPropertiesTab(el, this.plugin),
      },
    ]);

    tabs.render();
  }

  private renderSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Schema directory")
      .setDesc(
        "Folder containing entities/ and properties/ subdirectories, relative to vault root. " +
          'Use "." for vault root.',
          'It will create "entities" and "properties" dirs',
      )
      .addText((text) =>
        text
          .setPlaceholder(".")
          .setValue(this.plugin.settings.schemaDir)
          .onChange(async (value) => {
            this.plugin.settings.schemaDir = value || ".";
            this.plugin.schema = null;
            await this.plugin.saveSettings();
          }),
      );


    new Setting(containerEl)
      .setName("Entity field")
      .setDesc(
        "Frontmatter field name that identifies the entity type of a note. " +
          "For example: entity, type_name, type_key, type.",
      )
      .addText((text) =>
        text
          .setPlaceholder("entity")
          .setValue(this.plugin.settings.typeKeyField)
          .onChange(async (value) => {
            this.plugin.settings.typeKeyField = value || "entity";
            await this.plugin.saveSettings();
          }),
      );
    

    new Setting(containerEl)
      .setName("Show ribbon icon")
      .setDesc(
        "Show a ribbon icon in the left sidebar to validate the entire vault.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showRibbonIcon)
          .onChange(async (value) => {
            this.plugin.settings.showRibbonIcon = value;
            this.plugin.updateRibbonIcon();
            await this.plugin.saveSettings();
          }),
      );

    // --- How it works ---

    containerEl.createEl("h3", { text: "How it works" });

    const guide = containerEl.createDiv({ cls: "obsi-validate-guide" });

    guide.createEl("p", {
      text:
        "Property Validator checks your notes' frontmatter against schemas " +
        "defined in your vault as regular markdown files. " +
        "Use the Entities and Properties tabs to manage schemas.",
    });

    guide.createEl("h4", { text: "Directory structure" });
    const structPre = guide.createEl("pre");
    const schemaDir =
      this.plugin.settings.schemaDir === "."
        ? ""
        : this.plugin.settings.schemaDir + "/";
    structPre.createEl("code", {
      text:
        `${schemaDir}entities/      \u2190 entity definitions\n` +
        `  task_entity.md\n` +
        `  note_entity.md\n` +
        `${schemaDir}properties/    \u2190 property type definitions\n` +
        `  status.md\n` +
        `  priority.md`,
    });

    guide.createEl("h4", { text: "How notes are validated" });
    const typeKey = this.plugin.settings.typeKeyField;
    const steps = guide.createEl("ol");
    steps.createEl("li", {
      text: `The "${typeKey}" field in frontmatter determines the entity type.`,
    });
    steps.createEl("li", {
      text: "Unknown fields produce warnings (unless allow_extra: true on entity).",
    });
    steps.createEl("li", {
      text: "Known fields are validated against their property type and constraints.",
    });
    steps.createEl("li", {
      text: "Missing required fields produce errors.",
    });

    guide.createEl("h4", { text: "Supported property types" });
    const types = guide.createEl("ul");
    const typeList = [
      "string \u2014 any text",
      "number \u2014 numeric value (min_value, max_value)",
      "boolean \u2014 true/false",
      "date \u2014 YYYY-MM-DD",
      "time \u2014 time string",
      "datetime \u2014 date with time",
      "enum \u2014 one of allowed_values",
      "link / wikilink \u2014 string or array of strings",
      "list \u2014 array of values",
    ];
    for (const t of typeList) {
      types.createEl("li", { text: t });
    }

    guide.createEl("h4", { text: "Commands" });
    const cmds = guide.createEl("ul");
    cmds.createEl("li", {
      text: "Validate current file \u2014 check the active note (Cmd/Ctrl+P)",
    });
    cmds.createEl("li", {
      text: "Validate vault \u2014 scan all notes (ribbon icon or Cmd/Ctrl+P)",
    });
  }
}
