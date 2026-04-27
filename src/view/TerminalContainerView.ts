import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import * as os from "os";
import { createXtermHost, XtermHost } from "../terminal/xterm-host";
import {
  createElementCssVarReader,
  deriveXtermTheme,
} from "../terminal/theme";
import { PtyBackend } from "../pty/pty-backend";
import { TerminalBackend } from "../pty/terminal-backend";
import { AnvilSettings } from "../settings/settings";

export const TERMINAL_CONTAINER_VIEW_TYPE = "anvil-terminal-container-view";

export interface TerminalTabSpec {
  shell: string;
  shellArgs?: string[];
  cwd?: string;
}

interface HostPlugin extends Plugin {
  getDefaultShell?: () => string;
  getLastContainerHeight?: () => number | null;
  setLastContainerHeight?: (height: number) => void;
  // True while the plugin is about to call `addTab(spec)` manually after
  // `leaf.setViewState(...)` resolves. onOpen uses this to skip the default
  // blank tab it would otherwise create when Obsidian reconstructs the view
  // (app restart, workspace-plugin layout switch, popout).
  isExpectingManualTab?: () => boolean;
  // Phase 2: settings + a hook so the plugin can register the view for
  // theme-change broadcasts (R2 / R10). Both optional so the prior tests
  // keep building.
  getSettings?: () => AnvilSettings;
  registerThemeListener?: (view: TerminalContainerViewLike) => void;
  unregisterThemeListener?: (view: TerminalContainerViewLike) => void;
}

/** A narrow shape the plugin uses to broadcast theme/font changes back to
 *  open container views without taking a hard dependency on the class. */
export interface TerminalContainerViewLike {
  refreshThemeAndFont(): void;
}

interface TerminalTab {
  id: string;
  spec: TerminalTabSpec;
  host: XtermHost;
  backend: TerminalBackend;
  paneEl: HTMLElement;
  tabButtonEl: HTMLElement;
  tabLabelEl: HTMLElement;
  closeButtonEl: HTMLElement;
  keydownHandler: (ev: KeyboardEvent) => void;
}

export class TerminalContainerView extends ItemView {
  // Load-bearing R8a mitigation. Documented since Obsidian 0.15.1; no
  // feature-detect (minAppVersion is 1.5.0). Flip to true → R8a goes red.
  public navigation = false;

  private tabs: TerminalTab[] = [];
  private activeTabId: string | null = null;
  private tabCounter = 0;
  private tabStripEl: HTMLElement | null = null;
  private tabListEl: HTMLElement | null = null;
  private tabAddEl: HTMLElement | null = null;
  private contentAreaEl: HTMLElement | null = null;
  private bottomBufferEl: HTMLElement | null = null;
  private heightObserver: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: HostPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TERMINAL_CONTAINER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Terminal";
  }

  getIcon(): string {
    return "terminal-square";
  }

  async onOpen(): Promise<void> {
    this.buildChrome();
    this.plugin.registerThemeListener?.(this);
    // If the plugin initiated this open, it will call addTab(spec) itself
    // after setViewState resolves. Otherwise (app restart, workspace-plugin
    // layout switch, popout), Obsidian reconstructed us on its own and we
    // default to one blank terminal so the user doesn't see an empty shell.
    if (!this.plugin.isExpectingManualTab?.()) {
      await this.addTab(this.resolveDefaultSpec());
    }
  }

  /** Re-derive theme + reapply font for every tab (R2 / R10). Called by the
   *  plugin's css-change listener and after a settings update that affects
   *  the running terminal (font, theme overrides). Calls fit() directly per
   *  Phase 1 downstream notes — the coalescer is dimension-equality based
   *  and will short-circuit otherwise even though cell metrics shift. */
  refreshThemeAndFont(): void {
    const settings = this.plugin.getSettings?.();
    const overrides = settings?.themeOverrides ?? {
      solidBackground: false,
      useObsidianAccents: true,
    };
    for (const tab of this.tabs) {
      const theme = deriveXtermTheme({
        read: createElementCssVarReader(tab.paneEl),
        overrides,
      });
      tab.host.applyTheme(theme);
      if (settings?.fontFamily) tab.host.applyFontFamily(settings.fontFamily);
      if (settings?.fontSize) tab.host.applyFontSize(settings.fontSize);
      tab.host.fit();
    }
  }

  async onClose(): Promise<void> {
    this.plugin.unregisterThemeListener?.(this);
    this.snapshotHeight();
    if (this.heightObserver) {
      this.heightObserver.disconnect();
      this.heightObserver = null;
    }
    for (const tab of this.tabs) {
      this.removeTabEventHandlers(tab);
      try {
        await tab.backend.close();
      } catch {
        /* ignore */
      }
      try {
        tab.host.dispose();
      } catch {
        /* ignore */
      }
    }
    this.tabs = [];
    this.activeTabId = null;
    this.tabStripEl = null;
    this.tabListEl = null;
    this.tabAddEl = null;
    this.contentAreaEl = null;
    this.bottomBufferEl = null;
  }

  private buildChrome(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("anvil-terminal-container-view");

    this.tabStripEl = root.createDiv({ cls: "anvil-terminal-tabstrip" });
    // Tabs live in an inner flex row so the `+` button can be a persistent
    // rightmost sibling of the list without having to be detach/reappended
    // on every addTab/closeTab.
    this.tabListEl = this.tabStripEl.createDiv({ cls: "anvil-terminal-tab-list" });
    this.tabAddEl = this.tabStripEl.createDiv({ cls: "anvil-terminal-tab-add", text: "+" });
    this.tabAddEl.setAttr("aria-label", "New terminal");
    this.tabAddEl.setAttr("role", "button");
    this.tabAddEl.addEventListener("click", () => {
      void this.addTab(this.resolveDefaultSpec());
    });

    this.contentAreaEl = root.createDiv({ cls: "anvil-terminal-content" });
    this.bottomBufferEl = root.createDiv({ cls: "anvil-terminal-bottom-buffer" });

    this.restoreHeight();
    this.watchHeight();
  }

  private leafEl(): HTMLElement | null {
    const leaf = this.leaf as unknown as { containerEl?: HTMLElement };
    return leaf.containerEl ?? null;
  }

  private restoreHeight(): void {
    const last = this.plugin.getLastContainerHeight?.();
    const target = this.leafEl();
    if (!last || last <= 0 || !target) return;

    const leaf = this.leaf as unknown as {
      dimension?: number | null;
      parent?: {
        containerEl?: HTMLElement;
        children?: Array<{ dimension?: number | null; containerEl?: HTMLElement }>;
        recomputeChildrenDimensions?: () => void;
      };
    };
    const parent = leaf.parent;
    if (
      parent &&
      Array.isArray(parent.children) &&
      parent.children.length > 1 &&
      typeof parent.recomputeChildrenDimensions === "function"
    ) {
      // Obsidian's split-child dimension is treated as a weight —
      // recomputeChildrenDimensions() distributes parent's height proportionally.
      // Set sibling weights so their sum with the target equals the parent's
      // height, then ratio resolves to exactly `last` px for this leaf.
      const totalPx = parent.containerEl?.getBoundingClientRect().height ?? 0;
      const remaining = Math.max(1, totalPx - last);
      const siblings = parent.children.filter((c) => c !== (leaf as unknown));
      const perSibling = Math.max(1, Math.floor(remaining / siblings.length));
      for (const sibling of siblings) sibling.dimension = perSibling;
      leaf.dimension = last;
      parent.recomputeChildrenDimensions();
    } else {
      // Single-child (no siblings to balance) — inline flex is honoured.
      target.style.flex = `0 0 ${last}px`;
      target.style.height = `${last}px`;
    }
  }

  private watchHeight(): void {
    if (this.heightObserver) return;
    const target = this.leafEl();
    if (!target) return;
    this.heightObserver = new ResizeObserver(() => this.snapshotHeight());
    this.heightObserver.observe(target);
  }

  private snapshotHeight(): void {
    if (!this.plugin.setLastContainerHeight) return;
    const target = this.leafEl();
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.height > 0) this.plugin.setLastContainerHeight(rect.height);
  }

  onResize(): void {
    const active = this.tabs.find((t) => t.id === this.activeTabId);
    active?.host.fit();
  }

  getTabIds(): string[] {
    return this.tabs.map((t) => t.id);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  getActiveHost(): XtermHost | null {
    return this.tabs.find((t) => t.id === this.activeTabId)?.host ?? null;
  }

  getActiveBackend(): TerminalBackend | null {
    return this.tabs.find((t) => t.id === this.activeTabId)?.backend ?? null;
  }

  async addTab(spec: TerminalTabSpec): Promise<string> {
    if (!this.tabListEl || !this.contentAreaEl) return "";

    this.tabCounter += 1;
    const id = `tab-${this.tabCounter}`;
    const label = `Terminal ${this.tabCounter}`;

    const tabButtonEl = this.tabListEl.createDiv({ cls: "anvil-terminal-tab" });
    const tabLabelEl = tabButtonEl.createSpan({
      cls: "anvil-terminal-tab-label",
      text: label,
    });
    const closeButtonEl = tabButtonEl.createSpan({
      cls: "anvil-terminal-tab-close",
      text: "×",
    });
    closeButtonEl.setAttr("aria-label", "Close tab");
    closeButtonEl.setAttr("role", "button");

    const paneEl = this.contentAreaEl.createDiv({ cls: "anvil-terminal-pane" });
    // Prototype ordering (verified in the Phase 2 spike): mount xterm BEFORE
    // the pane is first made visible via switchTab so the shell's first
    // prompt is drawn with the correct cols/rows. Mounting on a hidden pane
    // yields degenerate dimensions; the subsequent fit() after switchTab
    // would SIGWINCH the shell mid-startup and leave zsh flagging every
    // prompt with PROMPT_EOL_MARK (%).
    const settings = this.plugin.getSettings?.();
    const themeOverrides = settings?.themeOverrides ?? {
      solidBackground: false,
      useObsidianAccents: true,
    };
    const initialTheme = deriveXtermTheme({
      read: createElementCssVarReader(paneEl),
      overrides: themeOverrides,
    });
    const host = createXtermHost({
      fontFamily: settings?.fontFamily,
      fontSize: settings?.fontSize,
      theme: initialTheme,
    });
    host.mount(paneEl);

    const backend = new PtyBackend({
      binaryPath: this.resolveBinaryPath(),
      shell: spec.shell,
      cwd: spec.cwd ?? this.resolveVaultRoot(),
      cols: host.terminal.cols,
      rows: host.terminal.rows,
      shellArgs: spec.shellArgs,
    });

    backend.onData((data) => host.write(data));
    backend.onExit(({ status, signal }) => {
      const detail = signal !== null ? `signal ${signal}` : `status ${status ?? "?"}`;
      host.write(`\r\n\x1b[33m[shell exited: ${detail}]\x1b[0m\r\n`);
    });
    host.onData((data) => backend.write(data));
    host.onResize(({ cols, rows }) => backend.resize(cols, rows));

    // FI-007: stop Ctrl bubbling so Obsidian's keymap doesn't fire after
    // xterm processes the key. Cmd left alone so command palette still works.
    const keydownHandler = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && !ev.metaKey) ev.stopPropagation();
    };
    paneEl.addEventListener("keydown", keydownHandler);

    const tab: TerminalTab = {
      id,
      spec,
      host,
      backend,
      paneEl,
      tabButtonEl,
      tabLabelEl,
      closeButtonEl,
      keydownHandler,
    };
    this.tabs.push(tab);

    tabButtonEl.addEventListener("click", (ev) => {
      if (ev.target === closeButtonEl) return;
      this.switchTab(id);
    });
    closeButtonEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void this.closeTab(id);
    });

    // Start the backend BEFORE revealing the tab. The shell's first prompt
    // then arrives with the pane already sized correctly. Previously this
    // fired asynchronously to satisfy AC8 (layout save/restore) — that AC
    // was dropped; the prototype ordering is restored.
    try {
      await backend.start();
    } catch (err) {
      host.write(
        `\r\n\x1b[31m[failed to start terminal backend: ${(err as Error).message}]\x1b[0m\r\n`,
      );
    }

    this.switchTab(id);
    return id;
  }

  switchTab(id: string): void {
    const incoming = this.tabs.find((t) => t.id === id);
    if (!incoming) return;

    for (const tab of this.tabs) {
      const isActive = tab.id === id;
      tab.paneEl.style.display = isActive ? "block" : "none";
      tab.tabButtonEl.toggleClass("is-active", isActive);
    }
    this.activeTabId = id;

    requestAnimationFrame(() => {
      incoming.host.fit();
      incoming.host.focus();
    });
  }

  async closeTab(id: string): Promise<void> {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];

    this.removeTabEventHandlers(tab);
    try {
      await tab.backend.close();
    } catch {
      /* ignore */
    }
    try {
      tab.host.dispose();
    } catch {
      /* ignore */
    }
    tab.tabButtonEl.detach();
    tab.paneEl.detach();
    this.tabs.splice(idx, 1);

    if (this.activeTabId === id) {
      const fallback = this.tabs[idx] ?? this.tabs[idx - 1] ?? null;
      this.activeTabId = fallback?.id ?? null;
      if (fallback) this.switchTab(fallback.id);
    }

    if (this.tabs.length === 0) {
      this.leaf.detach();
    }
  }

  private removeTabEventHandlers(tab: TerminalTab): void {
    tab.paneEl.removeEventListener("keydown", tab.keydownHandler);
  }

  private resolveDefaultSpec(): TerminalTabSpec {
    return { shell: this.detectShell() };
  }

  private resolveBinaryPath(): string {
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    const vaultRoot = adapter.basePath ?? "";
    const manifest = this.plugin.manifest;
    const dir = manifest.dir ?? path.join(".obsidian", "plugins", manifest.id);
    return path.join(vaultRoot, dir, "bin", "pty-server");
  }

  private resolveVaultRoot(): string {
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    return adapter.basePath ?? os.homedir();
  }

  private detectShell(): string {
    if (typeof this.plugin.getDefaultShell === "function") {
      const fromPlugin = this.plugin.getDefaultShell();
      if (fromPlugin && fromPlugin.length > 0) return fromPlugin;
    }
    return process.env.SHELL || "/bin/zsh";
  }
}
