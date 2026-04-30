import { Modal, App } from "obsidian";

/** Filter schema list items and folder headings by search query */
export function filterSchemaList(query: string, listEl: HTMLElement): void {
  const q = query.toLowerCase();
  listEl.querySelectorAll(".obsi-validate-schema-item").forEach((el) => {
    const name = (el as HTMLElement).dataset.name ?? "";
    (el as HTMLElement).style.display = name.includes(q) ? "" : "none";
  });
  listEl.querySelectorAll(".obsi-validate-folder-heading").forEach((el) => {
    let hasVisible = false;
    let sib = el.nextElementSibling;
    while (sib && sib.classList.contains("obsi-validate-schema-item")) {
      if ((sib as HTMLElement).style.display !== "none") hasVisible = true;
      sib = sib.nextElementSibling;
    }
    (el as HTMLElement).style.display = hasVisible ? "" : "none";
  });
}

/** Validate a schema name (entity or property) */
export function isValidSchemaName(name: string): string | null {
  if (!name) return "Name is required";
  if (name.length > 100) return "Name too long (max 100)";
  if (/[\/\\:*?"<>|]/.test(name)) return "Name contains invalid characters";
  if (name.startsWith(".") || name.startsWith("_")) return "Name cannot start with . or _";
  return null;
}

/** Confirmation modal for archiving schema files */
export class ConfirmArchiveModal extends Modal {
  private kind: string;
  private name: string;
  private onConfirm: () => void;

  constructor(app: App, kind: string, name: string, onConfirm: () => void) {
    super(app);
    this.kind = kind;
    this.name = name;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: `Archive ${this.kind}` });
    contentEl.createEl("p", {
      text: `Are you sure you want to archive "${this.name}"? The file will be moved to the _deprecated/ directory.`,
    });

    const actions = contentEl.createDiv({ cls: "obsi-validate-action-bar" });
    const confirmBtn = actions.createEl("button", {
      text: "Archive",
      cls: "mod-warning",
    });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });

    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
