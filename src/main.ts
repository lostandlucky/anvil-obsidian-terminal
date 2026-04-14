import { Plugin, WorkspaceLeaf } from "obsidian";
import { TerminalView, TERMINAL_VIEW_TYPE } from "./view/TerminalView";
import {
  BottomDock,
  createBottomDock,
  DockRootSplit,
  DockWorkspace,
} from "./dock/bottom-dock";
import {
  AnvilSettings,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "./settings/settings";
import { AnvilSettingsTab, SettingsTabHost } from "./settings/settings-tab";

export interface TerminalLaunchSpec {
  shell: string;
  shellArgs?: string[];
  cwd?: string;
}

export default class TerminalPlugin extends Plugin implements SettingsTabHost {
  private dock: BottomDock | null = null;
  private settings: AnvilSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());

    this.registerView(
      TERMINAL_VIEW_TYPE,
      (leaf) => new TerminalView(leaf, this),
    );

    this.addCommand({
      id: "open-terminal",
      name: "Open terminal",
      callback: () => this.openDefaultTerminal(),
    });

    this.addSettingTab(new AnvilSettingsTab(this, this));

    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.reconcileDock()),
    );
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(TERMINAL_VIEW_TYPE);
    this.dock = null;
  }

  getSettings(): AnvilSettings {
    return this.settings;
  }

  async updateSettings(patch: Partial<AnvilSettings>): Promise<void> {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    await this.saveData(this.settings);
  }

  getDefaultShell(): string {
    if (this.settings.defaultShell && this.settings.defaultShell.length > 0) {
      return this.settings.defaultShell;
    }
    return process.env.SHELL || "/bin/zsh";
  }

  async openDefaultTerminal(): Promise<void> {
    await this.openTerminalWithSpec({ shell: this.getDefaultShell() });
  }

  async openTerminalWithSpec(spec: TerminalLaunchSpec): Promise<void> {
    const dock = this.getDock();
    const leaf = dock.openLeaf() as WorkspaceLeaf;
    await leaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: true,
      state: {
        shell: spec.shell,
        shellArgs: spec.shellArgs,
        cwd: spec.cwd,
      },
    });
    this.app.workspace.revealLeaf(leaf);
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

  private reconcileDock(): void {
    if (!this.dock) return;
    const open = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE).length;
    while (this.dock.openLeafCount > open) {
      this.dock.notifyLeafClosed();
    }
  }
}
