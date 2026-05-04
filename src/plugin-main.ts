import { Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import type { VaultSchema, VaultIndex, ValidateOptions, ValidationResult, ValidationSummary } from "./types";
import { ensureSchema, bridgeValidateFile, bridgeValidateVault, buildVaultIndex } from "./bridge";
import { ResultsView } from "./ResultsView";
import { VaultResultsView } from "./VaultResultsView";
import { ObsiValidateSettingTab } from "./SettingsTab";
import {
  VIEW_TYPE_RESULTS,
  VIEW_TYPE_VAULT_RESULTS,
  DEFAULT_SETTINGS,
  type PluginSettings,
} from "./constants";

export default class ObsiValidatePlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  schema: VaultSchema | null = null;
  statusBarEl!: HTMLElement;
  ribbonIconEl: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  schemaLoading: Promise<VaultSchema> | null = null;
  lastResult: ValidationResult | null = null;
  private settingsTab: ObsiValidateSettingTab | null = null;
  private vaultIndex: VaultIndex | null = null;

  async onload() {
    await this.loadSettings();

    // Register views
    this.registerView(
      VIEW_TYPE_RESULTS,
      (leaf) => new ResultsView(leaf, this),
    );
    this.registerView(
      VIEW_TYPE_VAULT_RESULTS,
      (leaf) => new VaultResultsView(leaf, this),
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
        this.activateView(VIEW_TYPE_RESULTS).then(() => {
          const view = this.getView<ResultsView>(VIEW_TYPE_RESULTS);
          if (view && this.lastResult) view.renderSingleResult(this.lastResult);
        });
      },
    });

    // Status bar
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("obsi-validate-statusbar");
    this.statusBarEl.addEventListener("click", () => {
      if (this.lastResult) {
        this.activateView(VIEW_TYPE_RESULTS).then(() => {
          const view = this.getView<ResultsView>(VIEW_TYPE_RESULTS);
          if (view) view.renderSingleResult(this.lastResult!);
        });
      }
    });
    this.renderStatusBar();

    // Settings tab
    this.settingsTab = new ObsiValidateSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    // Watch file changes
    const isSchemaFile = (path: string) => {
      const dir = this.settings.schemaDir;
      const base = (!dir || dir === ".") ? "" : dir + "/";
      return path.startsWith(`${base}entities/`) || path.startsWith(`${base}properties/`);
    };

    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => {
        if (isSchemaFile(file.path)) {
          this.schema = null; this.schemaLoading = null;
        }
        if (file instanceof TFile && file.extension === "md") {
          this.vaultIndex = null;
          this.debouncedRevalidate();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        if (isSchemaFile(file.path)) { this.schema = null; this.schemaLoading = null; }
        this.vaultIndex = null;
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file: TAbstractFile) => {
        if (isSchemaFile(file.path)) { this.schema = null; this.schemaLoading = null; }
        this.vaultIndex = null;
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

    const vaultIndex = await this.getVaultIndex(schema);
    const result = await bridgeValidateFile(
      this.app,
      activeFile,
      schema,
      this.validateOptions(),
      vaultIndex ?? undefined,
    );

    this.lastResult = result;
    this.renderStatusBar();

    // Update results panel if it's open
    const view = this.getView<ResultsView>(VIEW_TYPE_RESULTS);
    if (view) view.renderSingleResult(result);
  }

  /** Get cached vault index, building it only if needed */
  private async getVaultIndex(schema: VaultSchema): Promise<VaultIndex | null> {
    const hasLinkConstraints = schema.properties.some((p) => p.link_constraints);
    if (!hasLinkConstraints) return null;
    if (this.vaultIndex) return this.vaultIndex;
    this.vaultIndex = await buildVaultIndex(this.app);
    return this.vaultIndex;
  }

  // --- Status bar ---

  private renderStatusBar() {
    this.statusBarEl.empty();
    const result = this.lastResult;

    // Hide when no active note or no entity type
    if (!result || !result.entityType) {
      this.statusBarEl.style.display = "none";
      return;
    }

    this.statusBarEl.style.display = "";

    // Status dot
    let dotCls = "obsi-validate-dot-valid";
    if (result.errors.length > 0) dotCls = "obsi-validate-dot-error";
    else if (result.warnings.length > 0) dotCls = "obsi-validate-dot-warn";
    this.statusBarEl.createSpan({ cls: `obsi-validate-dot ${dotCls}` });

    // Entity type
    this.statusBarEl.createSpan({
      text: result.entityType,
      cls: "obsi-validate-sb-entity",
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
    await this.showVaultResults(summary);
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

    const vaultIndex = await this.getVaultIndex(schema);
    const result = await bridgeValidateFile(
      this.app,
      activeFile,
      schema,
      this.validateOptions(),
      vaultIndex ?? undefined,
    );

    this.lastResult = result;
    this.renderStatusBar();

    await this.activateView(VIEW_TYPE_RESULTS);
    const view = this.getView<ResultsView>(VIEW_TYPE_RESULTS);
    if (view) view.renderSingleResult(result);
  }

  private async showVaultResults(summary: ValidationSummary) {
    await this.activateView(VIEW_TYPE_VAULT_RESULTS);
    const view = this.getView<VaultResultsView>(VIEW_TYPE_VAULT_RESULTS);
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
    return {
      typeKeyField: this.settings.typeKeyField,
      defaultEntityType: this.settings.defaultEntityType || undefined,
    };
  }

  private getView<T>(viewType: string): T | null {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    return leaves.length > 0 ? (leaves[0].view as T) : null;
  }

  private async activateView(viewType: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(viewType);
    if (existing.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: viewType, active: true });
      }
    }
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  /** Open plugin settings on a specific tab with search pre-filled */
  openSettingsTab(tab: "properties" | "entities", searchQuery: string) {
    if (!this.settingsTab) return;
    // Set navigation target before display() is called
    this.settingsTab.navigateTo(tab, searchQuery);
    // @ts-ignore — Obsidian internal API
    const setting = this.app.setting;
    if (setting) {
      setting.open();
      setting.openTabById("property-validator");
    }
  }

}
