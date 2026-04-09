import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_VAULT_RESULTS } from "./constants";
import type { ValidationResult, ValidationSummary } from "./types";
import type ObsiValidatePlugin from "./plugin-main";

export class VaultResultsView extends ItemView {
  plugin: ObsiValidatePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: ObsiValidatePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_VAULT_RESULTS;
  }

  getDisplayText(): string {
    return "Vault Validation";
  }

  getIcon(): string {
    return "shield-check";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl("p", {
      text: "Run \"Validate vault\" to see results.",
      cls: "obsi-validate-placeholder",
    });
  }

  async onClose() {
    this.containerEl.children[1].empty();
  }

  renderSummary(summary: ValidationSummary) {
    const container = this.containerEl.children[1];
    container.empty();

    const header = container.createDiv({ cls: "obsi-validate-header" });

    const titleRow = header.createDiv({ cls: "obsi-validate-title-row" });
    titleRow.createEl("h4", { text: "Vault Validation" });
    const refreshBtn = titleRow.createEl("button", {
      text: "\u21BB",
      cls: "obsi-validate-refresh-btn",
      attr: { "aria-label": "Re-validate vault" },
    });
    refreshBtn.addEventListener("click", () => {
      this.plugin.validateVault();
    });

    const stats = header.createDiv({ cls: "obsi-validate-stats" });
    stats.createSpan({ text: `Total: ${summary.total}` });
    stats.createSpan({ text: ` | Valid: ${summary.valid}`, cls: "obsi-validate-valid" });
    stats.createSpan({ text: ` | Invalid: ${summary.invalid}`, cls: "obsi-validate-invalid" });
    stats.createSpan({ text: ` | Skipped: ${summary.skipped}` });

    // Filter: only show files with issues
    const withIssues = summary.results.filter(
      (r) => r.errors.length > 0 || r.warnings.length > 0,
    );

    if (withIssues.length === 0) {
      container.createEl("p", {
        text: "All files are valid.",
        cls: "obsi-validate-success",
      });
      return;
    }

    const list = container.createDiv({ cls: "obsi-validate-results" });
    for (const result of withIssues) {
      this.renderResult(list, result);
    }
  }

  private renderResult(container: Element, result: ValidationResult) {
    const details = container.createEl("details", { cls: "obsi-validate-file" });
    details.setAttribute("open", "");

    const summary = details.createEl("summary");
    const tag = result.errors.length > 0 ? "FAIL" : "WARN";
    const tagCls = result.errors.length > 0 ? "obsi-validate-fail-tag" : "obsi-validate-warn-tag";
    summary.createSpan({ text: tag, cls: tagCls });
    summary.createSpan({ text: " " });

    const link = summary.createEl("a", {
      text: result.file,
      cls: "obsi-validate-file-link",
    });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const file = this.app.vault.getAbstractFileByPath(result.file);
      if (file instanceof TFile) {
        this.app.workspace.getLeaf(false).openFile(file);
      }
    });

    if (result.entityType) {
      summary.createSpan({
        text: ` [${result.entityType}]`,
        cls: "obsi-validate-entity-type",
      });
    }

    const issueList = details.createDiv({ cls: "obsi-validate-issues" });
    for (const err of result.errors) {
      const line = issueList.createDiv({ cls: "obsi-validate-error" });
      line.createSpan({ text: `  \u2717 ${err.field}: ${err.message}` });
    }
    for (const warn of result.warnings) {
      const line = issueList.createDiv({ cls: "obsi-validate-warning" });
      line.createSpan({ text: `  \u26A0 ${warn.field}: ${warn.message}` });
    }
  }
}
