import * as fs from "fs";
import { Plugin, WorkspaceLeaf } from "obsidian";
import {
  TerminalContainerView,
  TERMINAL_CONTAINER_VIEW_TYPE,
} from "./view/TerminalContainerView";
import {
  createWrapAndDock,
  WrapAndDock,
  WrapHandle,
  WrapSplit,
  WrapWorkspace,
} from "./dock/wrap-and-dock";
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

interface RootSplitLike extends WrapSplit {
  children: unknown[];
}

interface WorkspaceLike extends WrapWorkspace {
  rootSplit: RootSplitLike;
  createLeafInParent?: (parent: unknown, index: number) => WorkspaceLeaf;
}

export default class TerminalPlugin extends Plugin implements SettingsTabHost {
  private settings: AnvilSettings = { ...DEFAULT_SETTINGS };
  private wrapHandle: WrapHandle | null = null;
  private wrapAndDock: WrapAndDock | null = null;
  private lastContainerHeight: number | null = null;

  getLastContainerHeight(): number | null {
    return this.lastContainerHeight;
  }

  setLastContainerHeight(height: number): void {
    if (height > 0) this.lastContainerHeight = height;
  }

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());

    this.registerView(
      TERMINAL_CONTAINER_VIEW_TYPE,
      (leaf) => new TerminalContainerView(leaf, this),
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
      this.app.workspace.on("layout-change", () => this.reconcileWrap()),
    );
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(TERMINAL_CONTAINER_VIEW_TYPE);
    this.wrapHandle = null;
    this.wrapAndDock = null;
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
    const container = await this.getOrCreateContainerView();
    await container.addTab({
      shell: spec.shell,
      shellArgs: spec.shellArgs,
      cwd: spec.cwd,
    });
    this.app.workspace.revealLeaf(container.leaf);
  }

  private async getOrCreateContainerView(): Promise<TerminalContainerView> {
    const existing = this.app.workspace.getLeavesOfType(
      TERMINAL_CONTAINER_VIEW_TYPE,
    );
    if (existing.length > 0) {
      const view = existing[0].view as TerminalContainerView;
      return view;
    }

    const workspace = this.app.workspace as unknown as WorkspaceLike;
    const rootSplit = workspace.rootSplit;

    const wrapAndDock = createWrapAndDock({ workspace, rootSplit });
    this.wrapAndDock = wrapAndDock;
    this.wrapHandle = wrapAndDock.openWithWrap();

    const leaf = this.allocateContainerLeaf(workspace, rootSplit);

    await leaf.setViewState({
      type: TERMINAL_CONTAINER_VIEW_TYPE,
      active: true,
    });

    return leaf.view as TerminalContainerView;
  }

  private allocateContainerLeaf(
    workspace: WorkspaceLike,
    rootSplit: RootSplitLike,
  ): WorkspaceLeaf {
    if (typeof workspace.createLeafInParent === "function") {
      // Non-wrap path needs the flat flip to keep container below existing leaves.
      if (!this.wrapHandle && typeof rootSplit.setDirection === "function") {
        rootSplit.setDirection("horizontal");
      } else if (!this.wrapHandle) {
        rootSplit.direction = "horizontal";
      }
      return workspace.createLeafInParent(
        rootSplit,
        rootSplit.children.length,
      ) as WorkspaceLeaf;
    }

    // Fallback when createLeafInParent is absent. Expose a testable flag
    // alongside the console warning so AC10 can assert we took this path,
    // and so a future settings surface can show it to users.
    (window as unknown as { __anvilFallbackWarned?: boolean }).__anvilFallbackWarned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[anvil] workspace.createLeafInParent unavailable; degrading to getLeaf('split','horizontal') — container isolation reduced",
    );
    return this.app.workspace.getLeaf("split", "horizontal");
  }

  private reconcileWrap(): void {
    if (!this.wrapAndDock || !this.wrapHandle) return;
    const open = this.app.workspace.getLeavesOfType(
      TERMINAL_CONTAINER_VIEW_TYPE,
    ).length;
    if (open === 0) {
      try {
        this.wrapAndDock.closeWithUnwrap(this.wrapHandle);
      } finally {
        this.wrapHandle = null;
      }
    }
  }
}
