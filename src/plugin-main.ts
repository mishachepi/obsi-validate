import { Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import type { VaultSchema, ValidateOptions, ValidationResult, ValidationSummary } from "./types";
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
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private schemaLoading: Promise<VaultSchema> | null = null;
  lastResult: ValidationResult | null = null;

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

    this.addCommand({
      id: "show-validation-results",
      name: "Show validation results",
      callback: () => {
        this.activateResultsView().then(() => {
          const view = this.getResultsView();
          if (view && this.lastResult) view.renderSingleResult(this.lastResult);
        });
      },
    });

    // Status bar
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("obsi-validate-statusbar");
    this.renderStatusBar();

    // Settings tab
    this.addSettingTab(new ObsiValidateSettingTab(this.app, this));

    // Watch file changes
    const isSchemaFile = (path: string) => {
      const base = this.settings.schemaDir === "." ? "" : this.settings.schemaDir + "/";
      return path.startsWith(`${base}entities/`) || path.startsWith(`${base}properties/`);
    };

    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => {
        if (isSchemaFile(file.path)) {
          this.schema = null; this.schemaLoading = null;
        }
        // Re-validate active file on any modify (debounced)
        if (file instanceof TFile && file.extension === "md") {
          this.debouncedRevalidate();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        if (isSchemaFile(file.path)) { this.schema = null; this.schemaLoading = null; }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file: TAbstractFile) => {
        if (isSchemaFile(file.path)) { this.schema = null; this.schemaLoading = null; }
      }),
    );

    // Re-validate on active file change
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.silentValidateActiveFile();
      }),
    );

    // Initial validation
    this.silentValidateActiveFile();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  // --- Schema loading with mutex ---

  private async getSchema(): Promise<VaultSchema> {
    if (this.schema) return this.schema;
    if (this.schemaLoading) return this.schemaLoading;

    this.schemaLoading = ensureSchema(
      this.app,
      this.settings.schemaDir,
      null,
    ).then((s) => {
      this.schema = s;
      this.schemaLoading = null;
      return s;
    }).catch((e) => {
      this.schemaLoading = null;
      throw e;
    });
    return this.schemaLoading;
  }

  // --- Reactive validation ---

  private debouncedRevalidate() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const targetFile = this.app.workspace.getActiveFile();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const current = this.app.workspace.getActiveFile();
      if (current && targetFile && current.path === targetFile.path) {
        this.silentValidateActiveFile();
      }
    }, 800);
  }

  /** Silently validate active file, update status bar + results panel if open */
  async silentValidateActiveFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      this.lastResult = null;
      this.renderStatusBar();
      return;
    }

    let schema: VaultSchema;
    try {
      schema = await this.getSchema();
    } catch {
      this.lastResult = null;
      this.renderStatusBar();
      return;
    }

    const result = await bridgeValidateFile(
      this.app,
      activeFile,
      schema,
      this.validateOptions(),
    );

    this.lastResult = result;
    this.renderStatusBar();

    // Update results panel if it's open
    const view = this.getResultsView();
    if (view) view.renderSingleResult(result);
  }

  // --- Status bar ---

  private renderStatusBar() {
    this.statusBarEl.empty();
    const result = this.lastResult;

    if (!result || !result.entityType) {
      this.statusBarEl.createSpan({ text: "Property Validator", cls: "obsi-validate-sb-label" });
      return;
    }

    // Entity type
    this.statusBarEl.createSpan({
      text: `[${result.entityType}]`,
      cls: "obsi-validate-sb-entity",
    });

    // Status
    if (result.errors.length > 0) {
      this.statusBarEl.createSpan({
        text: ` ${result.errors.length} error(s)`,
        cls: "obsi-validate-sb-errors",
      });
    } else if (result.warnings.length > 0) {
      this.statusBarEl.createSpan({
        text: ` ${result.warnings.length} warn`,
        cls: "obsi-validate-sb-warnings",
      });
    } else {
      this.statusBarEl.createSpan({
        text: " valid",
        cls: "obsi-validate-sb-valid",
      });
    }

    // Play button — open results panel
    this.statusBarEl.createSpan({
      text: " \u25B6",
      cls: "obsi-validate-sb-btn",
    });

    // Click anywhere → open results panel
    this.statusBarEl.addEventListener("click", () => {
      if (this.lastResult) {
        this.activateResultsView().then(() => {
          const view = this.getResultsView();
          if (view) view.renderSingleResult(this.lastResult!);
        });
      }
    });
  }

  // --- Commands ---

  async validateVault() {
    let schema: VaultSchema;
    try {
      schema = await this.getSchema();
    } catch (e) {
      new Notice(
        `Property Validator: Failed to load schema from "${this.settings.schemaDir}". Check plugin settings.`,
      );
      return;
    }

    const summary = await bridgeValidateVault(this.app, schema, this.validateOptions());
    await this.showResults(summary);
    new Notice(
      `Validation complete: ${summary.invalid} errors, ${summary.valid} valid`,
    );
  }

  async validateCurrentFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    let schema: VaultSchema;
    try {
      schema = await this.getSchema();
    } catch (e) {
      new Notice(
        `Property Validator: Failed to load schema from "${this.settings.schemaDir}". Check plugin settings.`,
      );
      return;
    }

    const result = await bridgeValidateFile(
      this.app,
      activeFile,
      schema,
      this.validateOptions(),
    );

    this.lastResult = result;
    this.renderStatusBar();

    await this.activateResultsView();
    const view = this.getResultsView();
    if (view) view.renderSingleResult(result);
  }

  private async showResults(summary: ValidationSummary) {
    await this.activateResultsView();
    const view = this.getResultsView();
    if (view) view.renderSummary(summary);
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
