import { Plugin } from "obsidian";
import { TerminalView, TERMINAL_VIEW_TYPE } from "./view/TerminalView";

export default class TerminalPlugin extends Plugin {
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
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(TERMINAL_VIEW_TYPE);
  }

  private async openTerminal(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }
}
