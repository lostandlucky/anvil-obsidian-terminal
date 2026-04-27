import * as fs from "fs";
import { Plugin, WorkspaceLeaf } from "obsidian";
import {
  TerminalContainerView,
  TERMINAL_CONTAINER_VIEW_TYPE,
  TerminalContainerViewLike,
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
import {
  buildTmuxAttachArgs,
  buildTmuxNewSessionArgs,
} from "./profiles/tmux-args";

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
  private expectingManualTab = false;
  private insertingEmptySibling = false;
  private themeListeners = new Set<TerminalContainerViewLike>();

  getLastContainerHeight(): number | null {
    return this.lastContainerHeight;
  }

  setLastContainerHeight(height: number): void {
    if (height > 0) this.lastContainerHeight = height;
  }

  isExpectingManualTab(): boolean {
    return this.expectingManualTab;
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
      this.app.workspace.on("layout-change", () => {
        this.reconcileWrap();
        void this.reconcileEmptySibling();
      }),
    );

    // R2: re-derive themes when Obsidian's CSS changes (theme switch, snippet
    // edit, community-theme apply). The 'css-change' event is documented but
    // not always present on the typings package — feature-detect via a typed
    // extension shape rather than `any`.
    interface WorkspaceWithCssChange {
      on(name: "css-change", cb: () => void): import("obsidian").EventRef;
    }
    try {
      const ws = this.app.workspace as unknown as WorkspaceWithCssChange;
      this.registerEvent(
        ws.on("css-change", () => {
          this.broadcastThemeChange();
        }),
      );
    } catch {
      // Fallback: MutationObserver on body class (D1). Catches the
      // theme-light/theme-dark toggle even if css-change isn't wired up.
      const observer = new MutationObserver(() => this.broadcastThemeChange());
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
      this.register(() => observer.disconnect());
    }
  }

  registerThemeListener(view: TerminalContainerViewLike): void {
    this.themeListeners.add(view);
  }

  unregisterThemeListener(view: TerminalContainerViewLike): void {
    this.themeListeners.delete(view);
  }

  private broadcastThemeChange(): void {
    for (const view of this.themeListeners) {
      try {
        view.refreshThemeAndFont();
      } catch {
        /* a single bad view shouldn't kill the broadcast */
      }
    }
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
    // R10: settings that affect the running terminal (font, theme overrides)
    // propagate to open terminals. The broadcast is unconditional — cheap
    // (theme rederive + apply + fit), and avoids the trap of forgetting to
    // hook a future settings field into the propagation list.
    if (
      patch.fontFamily !== undefined ||
      patch.fontSize !== undefined ||
      patch.themeOverrides !== undefined
    ) {
      this.broadcastThemeChange();
    }
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
              const newArgs = buildTmuxNewSessionArgs({
                tmuxSessionNameFormat: this.settings.tmuxSessionNameFormat,
                existingNames: tmux.sessions.map((s) => s.name),
              });
              await this.openTerminalWithSpec({
                shell: tmux.tmuxPath,
                shellArgs: newArgs,
              });
            }
            return;
          case "tmux-session":
            if (tmux.tmuxPath) {
              const dims = this.readActiveHostDims();
              const attachArgs = buildTmuxAttachArgs({
                sessionName: choice.name,
                cols: dims.cols,
                rows: dims.rows,
                preserveTmuxDimensions: this.settings.preserveTmuxDimensions,
              });
              await this.openTerminalWithSpec({
                shell: tmux.tmuxPath,
                shellArgs: attachArgs,
              });
            }
            return;
        }
      },
    });
    modal.open();
  }

  /** Read the active terminal's pane size for tmux -x/-y. Falls back to
   *  zero — buildTmuxAttachArgs treats zero/negative as "don't pass dims."
   *  This is intentional: on first-ever attach (no tab open yet), we don't
   *  have a host to read from, and tmux's default sizing is fine. */
  private readActiveHostDims(): { cols: number; rows: number } {
    const containers = this.app.workspace.getLeavesOfType(
      TERMINAL_CONTAINER_VIEW_TYPE,
    );
    for (const leaf of containers) {
      const view = leaf.view as unknown as {
        getActiveHost?: () => {
          terminal: { cols: number; rows: number };
        } | null;
      };
      const host = view.getActiveHost?.();
      if (host && host.terminal.cols > 0 && host.terminal.rows > 0) {
        return { cols: host.terminal.cols, rows: host.terminal.rows };
      }
    }
    return { cols: 0, rows: 0 };
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

    // Flag the view's onOpen that the plugin will supply the first tab's
    // spec itself via addTab(). Without this, onOpen creates a blank default
    // tab (the restore path), and we'd end up with two tabs on every open.
    this.expectingManualTab = true;
    try {
      await leaf.setViewState({
        type: TERMINAL_CONTAINER_VIEW_TYPE,
        active: true,
      });
    } finally {
      this.expectingManualTab = false;
    }

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

  /**
   * When the container is open and would otherwise be the only leaf under
   * rootSplit, inject Obsidian's native `empty` placeholder so the user
   * always has a "Create new note / Go to file / Close" area above the
   * terminal. Matches Obsidian's own behaviour on an otherwise empty vault.
   * Only fires on the note→no-note transition; cold-open is already handled
   * by Obsidian's native empty-tab regeneration.
   */
  private async reconcileEmptySibling(): Promise<void> {
    if (this.insertingEmptySibling) return;
    const containers = this.app.workspace.getLeavesOfType(
      TERMINAL_CONTAINER_VIEW_TYPE,
    );
    if (containers.length === 0) return;

    const workspace = this.app.workspace as unknown as WorkspaceLike;
    const rootSplit = workspace.rootSplit;

    if (this.hasNonContainerLeaf(rootSplit)) return;
    if (typeof workspace.createLeafInParent !== "function") return;

    this.insertingEmptySibling = true;
    try {
      // Use Obsidian's native split path rather than createLeafInParent.
      // createLeafInParent produces a bare leaf (no WorkspaceTabs wrapper)
      // which shows up as "no tab bar" — the exact bug this reconciler
      // exists to avoid. getLeaf("split", dir) walks Obsidian's normal
      // split machinery, which wraps the new leaf in a WorkspaceTabs and
      // so gives it the native tab chip / close X.
      //
      // Direction must match rootSplit.direction for the new leaf to be
      // added as a DIRECT sibling within rootSplit rather than nested in
      // a new sub-split. rootSplit is flipped to "horizontal" on container
      // open (see allocateContainerLeaf).
      const ws = this.app.workspace as typeof this.app.workspace & {
        setActiveLeaf: (leaf: WorkspaceLeaf, opts?: { focus?: boolean }) => void;
        getLeaf: (newLeaf: "split", direction: "horizontal" | "vertical") => WorkspaceLeaf;
      };
      ws.setActiveLeaf(containers[0], { focus: false });
      const leaf = ws.getLeaf("split", "horizontal");
      await leaf.setViewState({ type: "empty" });

      // getLeaf("split") places the new leaf AFTER the pivot (the container),
      // which puts the empty area below the terminal. Move the new leaf's
      // WorkspaceTabs wrapper to index 0 so the empty area sits above the
      // terminal — matches the docked-chrome UX the rest of Phase 3 assumes.
      const rs = rootSplit as unknown as {
        children: unknown[];
        insertChild?: (idx: number, child: unknown) => void;
        removeChild?: (child: unknown) => void;
      };
      const wrapper = (leaf as unknown as { parent?: unknown }).parent;
      if (
        wrapper &&
        typeof rs.removeChild === "function" &&
        typeof rs.insertChild === "function" &&
        rs.children.indexOf(wrapper) > 0
      ) {
        rs.removeChild(wrapper);
        rs.insertChild(0, wrapper);
      }
    } catch {
      /* best-effort — no crash on undocumented-API failure */
    } finally {
      this.insertingEmptySibling = false;
    }
  }

  /** Walk rootSplit's descendants looking for any leaf whose view is not
   *  our container. Used by reconcileEmptySibling. */
  private hasNonContainerLeaf(node: unknown): boolean {
    const n = node as {
      children?: unknown[];
      view?: { getViewType?: () => string };
    };
    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        if (this.hasNonContainerLeaf(child)) return true;
      }
      return false;
    }
    // Leaf node — check its view type.
    const type = n.view?.getViewType?.();
    return !!type && type !== TERMINAL_CONTAINER_VIEW_TYPE;
  }
}
