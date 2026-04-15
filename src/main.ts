import * as fs from "fs";
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
import { discoverShells } from "./profiles/shell-discovery";
import {
  createSystemTmuxRunner,
  discoverTmux,
  TmuxDiscoveryResult,
} from "./profiles/tmux-discovery";
import { ProfilePickerModal } from "./picker/profile-picker";

export interface TerminalLaunchSpec {
  shell: string;
  shellArgs?: string[];
  cwd?: string;
}

export default class TerminalPlugin extends Plugin implements SettingsTabHost {
  private dock: BottomDock | null = null;
  private settings: AnvilSettings = { ...DEFAULT_SETTINGS };
  private pendingSpecs = new WeakMap<WorkspaceLeaf, TerminalLaunchSpec>();

  consumePendingSpec(leaf: WorkspaceLeaf): TerminalLaunchSpec | null {
    const spec = this.pendingSpecs.get(leaf) ?? null;
    if (spec) this.pendingSpecs.delete(leaf);
    return spec;
  }

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());

    this.registerView(
      TERMINAL_VIEW_TYPE,
      (leaf) => new TerminalView(leaf, this),
    );

    this.addCommand({
      id: "open-terminal",
      name: "Open terminal",
      callback: () => {
        void this.openPicker();
      },
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

  async openPicker(): Promise<void> {
    const shells = discoverShells({
      envShell: process.env.SHELL,
      userShells: this.settings.userShellList,
      exists: (p) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      },
    });

    let tmux: TmuxDiscoveryResult;
    try {
      tmux = await discoverTmux(createSystemTmuxRunner());
    } catch {
      tmux = { installed: false, tmuxPath: null, sessions: [] };
    }

    const modal = new ProfilePickerModal(this.app, {
      shells,
      tmux,
      defaultShellPath: this.getDefaultShell(),
      onChoose: async (choice) => {
        switch (choice.kind) {
          case "shell":
            await this.openTerminalWithSpec({ shell: choice.path });
            return;
          case "new-tmux":
            if (tmux.tmuxPath) {
              await this.openTerminalWithSpec({
                shell: tmux.tmuxPath,
                shellArgs: ["new-session"],
              });
            }
            return;
          case "tmux-session":
            if (tmux.tmuxPath) {
              await this.openTerminalWithSpec({
                shell: tmux.tmuxPath,
                shellArgs: ["attach-session", "-t", choice.name],
              });
            }
            return;
        }
      },
    });
    modal.open();
  }

  async openTerminalWithSpec(spec: TerminalLaunchSpec): Promise<void> {
    const dock = this.getDock();
    const leaf = dock.openLeaf() as WorkspaceLeaf;
    // Stash the spec BEFORE calling setViewState so TerminalView.onOpen can
    // pick it up regardless of whether Obsidian calls setState before or
    // after onOpen. The state field is still passed for layout persistence.
    this.pendingSpecs.set(leaf, spec);
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
