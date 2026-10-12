import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsiValidatePlugin from "./plugin-main";
import { TabManager } from "./ui/TabManager";
import { renderEntitiesTab } from "./ui/EntitiesTab";
import { renderPropertiesTab } from "./ui/PropertiesTab";

export class ObsiValidateSettingTab extends PluginSettingTab {
  plugin: ObsiValidatePlugin;
  private defaultTab: string | undefined;
  private searchAfterRender: string | null = null;

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
    ], this.defaultTab);

    tabs.render();

    if (this.searchAfterRender !== null) {
      const query = this.searchAfterRender;
      this.fillSearch(query);
    }
  }

  /** Navigate to a tab and fill search. Call BEFORE triggering display(). */
  navigateTo(tab: string, query: string): void {
    this.defaultTab = tab;
    this.searchAfterRender = query;
  }

  private fillSearch(query: string): void {
    const tryFill = (attempts: number) => {
      const searchEl = this.containerEl.querySelector(
        ".obsi-validate-tab-content .obsi-validate-search",
      ) as HTMLInputElement;
      if (searchEl) {
        searchEl.value = query;
        searchEl.dispatchEvent(new Event("input"));
        searchEl.focus();
        // Clear navigation state after successful fill
        this.defaultTab = undefined;
        this.searchAfterRender = null;
      } else if (attempts > 0) {
        setTimeout(() => tryFill(attempts - 1), 150);
      }
    };
    tryFill(10);
  }

  private renderSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Schema directory")
      .setDesc(
        "Folder containing entities/ and properties/ subdirectories, relative to vault root. " +
          'Use "." for vault root. The folders are created with the first entity or property.',
      )
      .addText((text) =>
        text
          .setPlaceholder(".")
          .setValue(this.plugin.settings.schemaDir)
          .onChange(async (value) => {
            this.plugin.settings.schemaDir = value || ".";
            this.plugin.invalidateSchema();
            await this.plugin.saveSettings();
          }),
      );


    new Setting(containerEl)
      .setName("Type key field")
      .setDesc(
        "Frontmatter field that names a note's type, e.g. type_key or entity. " +
          "Leave empty to detect it from the schema: type_key if a type_key property exists, else entity.",
      )
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.typeKeyField)
          .onChange(async (value) => {
            this.plugin.settings.typeKeyField = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Default entity type")
      .setDesc(
        "Type for notes without a type field. Leave empty to skip such notes.",
      )
      .addDropdown((dd) => {
        dd.addOption("", "(none — skip)");
        // Populate from schema if available
        if (this.plugin.schema) {
          for (const e of this.plugin.schema.entities) {
            dd.addOption(e.name, e.name);
          }
        }
        dd.setValue(this.plugin.settings.defaultEntityType);
        dd.onChange(async (value) => {
          this.plugin.settings.defaultEntityType = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Check links in the note body")
      .setDesc("Also report wikilinks and inline [key:: value] properties in the body that point to missing notes.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.checkLinks).onChange(async (value) => {
          this.plugin.settings.checkLinks = value;
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
        "Each note's type field names an entity; the entity lists the note's properties, and each " +
        "property note defines what a valid value is. Manage them in the Entities and Properties tabs.",
    });
    const dir = this.plugin.settings.schemaDir === "." ? "" : `${this.plugin.settings.schemaDir}/`;
    guide.createEl("pre").createEl("code", {
      text: `${dir}entities/task_entity.md\n${dir}properties/status_property.md`,
    });
    const more = guide.createEl("p", { text: "Property types, rules and examples: " });
    more.createEl("a", { text: "schema reference", href: "https://obsi-validate.mchep.dev/schema-reference/" });
  }
}
