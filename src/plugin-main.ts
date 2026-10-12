import { Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import type { VaultSchema, ValidateOptions, ValidationResult, ValidationSummary } from "./types";
import { LinkIndexCache, isInSchemaFolders, loadSchemaFromVault, needsLinkIndex, validateNote, validateVaultNotes } from "./bridge";
import { resolveTypeKeyField } from "./schema";
import { isInSkippedDir, isValidationTarget } from "./vault-files";
import { ResultsView } from "./ResultsView";
import { VaultResultsView } from "./VaultResultsView";
import { findView } from "./view-lookup";
import { ObsiValidateSettingTab } from "./SettingsTab";
import {
  VIEW_TYPE_RESULTS,
  VIEW_TYPE_VAULT_RESULTS,
  DEFAULT_SETTINGS,
  type PluginSettings,
} from "./plugin-settings";

export default class ObsiValidatePlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  schema: VaultSchema | null = null;
  statusBarEl!: HTMLElement;
  ribbonIconEl: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  schemaLoading: Promise<VaultSchema> | null = null;
  lastResult: ValidationResult | null = null;
  private settingsTab: ObsiValidateSettingTab | null = null;
  private linkIndex = new LinkIndexCache(this.app);

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
          const view = this.getView(VIEW_TYPE_RESULTS, ResultsView);
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
          const view = this.getView(VIEW_TYPE_RESULTS, ResultsView);
          if (view) view.renderSingleResult(this.lastResult!);
        });
      }
    });
    this.renderStatusBar();

    // Settings tab
    this.settingsTab = new ObsiValidateSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    // Keep the schema and the link index in step with the vault
    const touched = (path: string) => {
      if (isInSchemaFolders(path, this.settings.schemaDir)) this.invalidateSchema();
    };
    this.registerEvent(
      this.app.vault.on("modify", async (file: TAbstractFile) => {
        touched(file.path);
        await this.linkIndex.update(file);
        if (file instanceof TFile && file.extension === "md") this.debouncedRevalidate();
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file: TAbstractFile) => {
        touched(file.path);
        void this.linkIndex.update(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        touched(file.path);
        this.linkIndex.remove(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        touched(oldPath);
        touched(file.path);
        this.linkIndex.remove(oldPath);
        void this.linkIndex.update(file);
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

  // --- Schema loading: one load at a time ---

  invalidateSchema() {
    this.schema = null;
    this.schemaLoading = null;
  }

  async getSchema(): Promise<VaultSchema> {
    if (this.schema) return this.schema;
    if (this.schemaLoading) return this.schemaLoading;

    this.schemaLoading = loadSchemaFromVault(this.app, this.settings.schemaDir).then((s) => {
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

  /** Validate the active note, or null when there is none to validate. */
  private async validateActiveNote(): Promise<ValidationResult | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !isValidationTarget(file.path) || isInSkippedDir(file.path)) return null;
    const schema = await this.getSchema();
    return validateNote(this.app, file, schema, await this.validateOptions(schema));
  }

  private showResult(result: ValidationResult | null) {
    this.lastResult = result;
    this.renderStatusBar();
    const view = this.getView(VIEW_TYPE_RESULTS, ResultsView);
    if (view && result) view.renderSingleResult(result);
  }

  /** Validate the active note quietly: status bar, plus the results panel if it is open. */
  async silentValidateActiveFile() {
    this.showResult(await this.validateActiveNote().catch(() => null));
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

  private schemaLoadFailed() {
    new Notice(`Property Validator: Failed to load schema from "${this.settings.schemaDir}". Check plugin settings.`);
  }

  async validateVault() {
    let schema: VaultSchema;
    try {
      schema = await this.getSchema();
    } catch {
      return this.schemaLoadFailed();
    }
    const summary = await validateVaultNotes(this.app, schema, await this.validateOptions(schema));
    await this.showVaultResults(summary);
    new Notice(`Validation complete: ${summary.invalid} errors, ${summary.valid} valid`);
  }

  async validateCurrentFile() {
    let result: ValidationResult | null;
    try {
      result = await this.validateActiveNote();
    } catch {
      return this.schemaLoadFailed();
    }
    if (!result) {
      new Notice("Property Validator: this note is not validated (archived, a folder index, or not markdown).");
      return;
    }
    await this.activateView(VIEW_TYPE_RESULTS);
    this.showResult(result);
  }

  private async showVaultResults(summary: ValidationSummary) {
    await this.activateView(VIEW_TYPE_VAULT_RESULTS);
    const view = this.getView(VIEW_TYPE_VAULT_RESULTS, VaultResultsView);
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

  /** The same options the CLI derives: type field from the setting or the
   * schema, and the link index when links are checked. */
  private async validateOptions(schema: VaultSchema): Promise<ValidateOptions> {
    return {
      typeKeyField: resolveTypeKeyField(schema, this.settings.typeKeyField),
      defaultEntityType: this.settings.defaultEntityType || undefined,
      checkLinks: this.settings.checkLinks,
      vaultIndex: needsLinkIndex(schema, this.settings.checkLinks) ? await this.linkIndex.get() : undefined,
    };
  }

  private getView<T>(viewType: string, ctor: abstract new (...args: never[]) => T): T | null {
    return findView(this.app.workspace.getLeavesOfType(viewType), ctor);
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
      await this.app.workspace.revealLeaf(leaves[0]);
      await leaves[0].loadIfDeferred?.();
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
