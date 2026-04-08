import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_RESULTS } from "./constants";
import type { ValidationResult, ValidationSummary } from "../../src/types";
import type ObsiValidatePlugin from "./main";

export class ResultsView extends ItemView {
  plugin: ObsiValidatePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: ObsiValidatePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_RESULTS;
  }

  getDisplayText(): string {
    return "Validation Results";
  }

  getIcon(): string {
    return "check-circle";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl("p", {
      text: "Run validation to see results.",
      cls: "obsi-validate-placeholder",
    });
  }

  async onClose() {
    this.containerEl.children[1].empty();
  }

  renderSummary(summary: ValidationSummary) {
    const container = this.containerEl.children[1];
    container.empty();

    // Summary header
    const header = container.createDiv({ cls: "obsi-validate-header" });
    header.createEl("h4", { text: "Validation Results" });
    const stats = header.createDiv({ cls: "obsi-validate-stats" });
    stats.createSpan({ text: `Total: ${summary.total}` });
    stats.createSpan({ text: ` | Valid: ${summary.valid}`, cls: "obsi-validate-valid" });
    stats.createSpan({ text: ` | Invalid: ${summary.invalid}`, cls: "obsi-validate-invalid" });
    stats.createSpan({ text: ` | Skipped: ${summary.skipped}` });

    if (summary.results.length === 0) {
      container.createEl("p", {
        text: "All files are valid.",
        cls: "obsi-validate-success",
      });
      return;
    }

    // Results list
    const list = container.createDiv({ cls: "obsi-validate-results" });
    for (const result of summary.results) {
      this.renderResult(list, result);
    }
  }

  renderSingleResult(result: ValidationResult) {
    const container = this.containerEl.children[1];
    container.empty();

    const header = container.createDiv({ cls: "obsi-validate-header" });
    header.createEl("h4", { text: "Validation Result" });

    if (result.errors.length === 0 && result.warnings.length === 0) {
      container.createEl("p", {
        text: `${result.file} is valid.`,
        cls: "obsi-validate-success",
      });
      return;
    }

    const list = container.createDiv({ cls: "obsi-validate-results" });
    this.renderResult(list, result);
  }

  private renderResult(container: Element, result: ValidationResult) {
    const details = container.createEl("details", { cls: "obsi-validate-file" });
    details.setAttribute("open", "");

    const summary = details.createEl("summary");
    const tag = result.valid ? "WARN" : "FAIL";
    const tagCls = result.valid ? "obsi-validate-warn-tag" : "obsi-validate-fail-tag";
    summary.createSpan({ text: tag, cls: tagCls });
    summary.createSpan({ text: " " });

    const link = summary.createEl("a", {
      text: result.file,
      cls: "obsi-validate-file-link",
    });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      this.navigateToFile(result.file);
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

  private navigateToFile(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      this.app.workspace.getLeaf(false).openFile(file);
    }
  }
}
