export type TabDef = {
  id: string;
  label: string;
  render: (containerEl: HTMLElement) => void | Promise<void>;
};

export class TabManager {
  private activeTabId: string;
  private navEl!: HTMLElement;
  private contentEl!: HTMLElement;

  constructor(
    private containerEl: HTMLElement,
    private tabs: TabDef[],
    defaultTab?: string,
  ) {
    this.activeTabId = defaultTab ?? tabs[0]?.id ?? "";
  }

  render(): void {
    // Nav bar
    this.navEl = this.containerEl.createDiv({ cls: "obsi-validate-tab-nav" });
    for (const tab of this.tabs) {
      const btn = this.navEl.createEl("button", {
        text: tab.label,
        cls: "obsi-validate-tab-btn",
      });
      btn.dataset.tab = tab.id;
      if (tab.id === this.activeTabId) {
        btn.addClass("active");
      }
      btn.addEventListener("click", () => this.switchTab(tab.id));
    }

    // Content area
    this.contentEl = this.containerEl.createDiv({
      cls: "obsi-validate-tab-content",
    });

    this.renderActiveTab();
  }

  switchTab(tabId: string): void {
    this.activeTabId = tabId;

    // Update nav buttons
    const buttons = this.navEl.querySelectorAll(".obsi-validate-tab-btn");
    buttons.forEach((btn) => {
      const el = btn as HTMLElement;
      if (el.dataset.tab === tabId) {
        el.addClass("active");
      } else {
        el.removeClass("active");
      }
    });

    this.renderActiveTab();
  }

  private renderActiveTab(): void {
    this.contentEl.empty();
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (tab) {
      tab.render(this.contentEl);
    }
  }
}
