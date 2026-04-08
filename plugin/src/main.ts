import { Notice, Plugin, TAbstractFile } from "obsidian";
import type { VaultSchema, ValidateOptions, ValidationSummary } from "../../src/types";
import { ensureSchema, bridgeValidateFile, bridgeValidateVault } from "./bridge";
import { ResultsView } from "./ResultsView";
import { ObsiValidateSettingTab } from "./SettingsTab";
import {
  VIEW_TYPE_RESULTS,
  DEFAULT_SETTINGS,
  type PluginSettings,
} from "./constants";

export default class ObsiValidatePlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  schema: VaultSchema | null = null;
  statusBarEl!: HTMLElement;
  ribbonIconEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    // Register results view
    this.registerView(
      VIEW_TYPE_RESULTS,
      (leaf) => new ResultsView(leaf, this),
    );

    // Ribbon icon — full vault scan (off by default)
    this.updateRibbonIcon();

    // Commands
    this.addCommand({
      id: "validate-current-file",
      name: "Validate current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.validateCurrentFile();
        return true;
      },
    });

    this.addCommand({
      id: "validate-vault",
      name: "Validate vault",
      callback: () => this.validateVault(),
    });

    // Status bar
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.setText("obsi-validate: ready");
    this.statusBarEl.addEventListener("click", () => {
      this.activateResultsView();
    });

    // Settings tab
    this.addSettingTab(new ObsiValidateSettingTab(this.app, this));

    // Watch schema directory for changes → invalidate cache
    const isSchemaFile = (path: string) => {
      const base = this.settings.schemaDir === "." ? "" : this.settings.schemaDir + "/";
      return path.startsWith(`${base}entities/`) || path.startsWith(`${base}properties/`);
    };
    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => {
        if (isSchemaFile(file.path)) this.schema = null;
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        if (isSchemaFile(file.path)) this.schema = null;
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file: TAbstractFile) => {
        if (isSchemaFile(file.path)) this.schema = null;
      }),
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async validateVault() {
    try {
      this.schema = await ensureSchema(
        this.app,
        this.settings.schemaDir,
        this.schema,
      );
    } catch (e) {
      new Notice(
        `obsi-validate: Failed to load schema from "${this.settings.schemaDir}". Check plugin settings.`,
      );
      return;
    }

    const summary = await bridgeValidateVault(this.app, this.schema, this.validateOptions());
    await this.showResults(summary);
    this.updateStatusBar(summary);
    new Notice(
      `Validation complete: ${summary.invalid} errors, ${summary.valid} valid`,
    );
  }

  async validateCurrentFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    try {
      this.schema = await ensureSchema(
        this.app,
        this.settings.schemaDir,
        this.schema,
      );
    } catch (e) {
      new Notice(
        `obsi-validate: Failed to load schema from "${this.settings.schemaDir}". Check plugin settings.`,
      );
      return;
    }

    const result = await bridgeValidateFile(
      this.app,
      activeFile,
      this.schema,
      this.validateOptions(),
    );

    await this.activateResultsView();
    const view = this.getResultsView();
    if (view) view.renderSingleResult(result);
  }

  private async showResults(summary: ValidationSummary) {
    await this.activateResultsView();
    const view = this.getResultsView();
    if (view) view.renderSummary(summary);
  }

  private updateStatusBar(summary: ValidationSummary) {
    if (summary.invalid === 0) {
      this.statusBarEl.setText(`obsi-validate: ${summary.valid} valid`);
    } else {
      this.statusBarEl.setText(
        `obsi-validate: ${summary.invalid} errors`,
      );
    }
  }

  updateRibbonIcon() {
    if (this.settings.showRibbonIcon) {
      if (!this.ribbonIconEl) {
        this.ribbonIconEl = this.addRibbonIcon("check-circle", "Validate vault", () => {
          this.validateVault();
        });
      }
    } else {
      if (this.ribbonIconEl) {
        this.ribbonIconEl.detach();
        this.ribbonIconEl = null;
      }
    }
  }

  private validateOptions(): ValidateOptions {
    return { typeKeyField: this.settings.typeKeyField };
  }

  private getResultsView(): ResultsView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RESULTS);
    if (leaves.length > 0) {
      return leaves[0].view as ResultsView;
    }
    return null;
  }

  async activateResultsView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_RESULTS);
    if (existing.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_RESULTS, active: true });
      }
    }
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RESULTS);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }
}
