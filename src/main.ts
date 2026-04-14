import { Plugin, WorkspaceLeaf } from "obsidian";
import { TerminalView, TERMINAL_VIEW_TYPE } from "./view/TerminalView";
import {
  BottomDock,
  createBottomDock,
  DockRootSplit,
  DockWorkspace,
} from "./dock/bottom-dock";

export default class TerminalPlugin extends Plugin {
  private dock: BottomDock | null = null;

  async onload(): Promise<void> {
    this.registerView(
      TERMINAL_VIEW_TYPE,
      (leaf) => new TerminalView(leaf, this),
    );

    this.addCommand({
      id: "open-terminal",
      name: "Open terminal",
      callback: () => this.openTerminal(),
    });

    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.reconcileDock()),
    );
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(TERMINAL_VIEW_TYPE);
    this.dock = null;
  }

  private getDock(): BottomDock {
    if (!this.dock) {
      const workspace = this.app.workspace as unknown as DockWorkspace & {
        rootSplit: DockRootSplit;
      };
      this.dock = createBottomDock({
        workspace,
        rootSplit: workspace.rootSplit,
      });
    }
    return this.dock;
  }

  private async openTerminal(): Promise<void> {
    const dock = this.getDock();
    const leaf = dock.openLeaf() as WorkspaceLeaf;
    await leaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  private reconcileDock(): void {
    if (!this.dock) return;
    const open = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE).length;
    while (this.dock.openLeafCount > open) {
      this.dock.notifyLeafClosed();
    }
  }
}
