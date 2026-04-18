import { ItemView, Plugin, ViewStateResult, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import * as os from "os";
import { createXtermHost, XtermHost } from "../terminal/xterm-host";
import { PtyBackend } from "../pty/pty-backend";
import { TerminalBackend } from "../pty/terminal-backend";

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
  private pendingSpecs: TerminalTabSpec[] = [];
  private tabCounter = 0;
  private tabStripEl: HTMLElement | null = null;
  private contentAreaEl: HTMLElement | null = null;
  private bottomBufferEl: HTMLElement | null = null;
  private heightObserver: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: HostPlugin) {
    super(leaf);
    this.addAction("plus", "New terminal", () => {
      void this.addTab(this.resolveDefaultSpec());
    });
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

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state && typeof state === "object") {
      const s = state as Record<string, unknown>;
      const rawTabs = Array.isArray(s.tabs) ? s.tabs : null;
      if (rawTabs) {
        this.pendingSpecs = rawTabs
          .map((t) => this.coerceSpec(t))
          .filter((spec): spec is TerminalTabSpec => spec !== null);
      }
    }
    await super.setState(state, result);
    // Build chrome eagerly + drain within setState so the caller (typically
    // changeLayout) gets synchronous tab materialization. Drain relies on
    // addTab being synchronous through this.tabs.push (backend starts async).
    this.ensureChrome();
    await this.drainPendingSpecs();
  }

  getState(): Record<string, unknown> {
    const base = (super.getState() ?? {}) as Record<string, unknown>;
    const tabs = this.tabs.map((t) => ({
      shell: t.spec.shell,
      shellArgs: t.spec.shellArgs,
      cwd: t.spec.cwd,
    }));
    return { ...base, tabs };
  }

  async onOpen(): Promise<void> {
    this.ensureChrome();
    await this.drainPendingSpecs();
  }

  async onClose(): Promise<void> {
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
    this.contentAreaEl = null;
    this.bottomBufferEl = null;
  }

  private ensureChrome(): void {
    if (this.tabStripEl) return;
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("anvil-terminal-container-view");

    this.tabStripEl = root.createDiv({ cls: "anvil-terminal-tabstrip" });
    this.contentAreaEl = root.createDiv({ cls: "anvil-terminal-content" });
    this.bottomBufferEl = root.createDiv({ cls: "anvil-terminal-bottom-buffer" });

    this.restoreHeight();
    this.watchHeight();
  }

  private async drainPendingSpecs(): Promise<void> {
    if (!this.tabStripEl || this.pendingSpecs.length === 0) return;
    const queued = this.pendingSpecs;
    this.pendingSpecs = [];
    for (const spec of queued) {
      await this.addTab(spec);
    }
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

  getTabSpecs(): TerminalTabSpec[] {
    return this.tabs.map((t) => ({ ...t.spec }));
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  async addTab(spec: TerminalTabSpec): Promise<string> {
    if (!this.tabStripEl || !this.contentAreaEl) {
      this.pendingSpecs.push(spec);
      return "";
    }

    this.tabCounter += 1;
    const id = `tab-${this.tabCounter}`;
    const label = `Terminal ${this.tabCounter}`;

    const tabButtonEl = this.tabStripEl.createDiv({ cls: "anvil-terminal-tab" });
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
    paneEl.style.display = "none";

    const host = createXtermHost();
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

    this.switchTab(id);
    this.persistState();

    // Fire backend start without awaiting so `this.tabs.push` above is
    // synchronously visible to callers. setState → drainPendingSpecs needs
    // to complete within Obsidian's changeLayout() window, and changeLayout
    // does not fully await our setState promise.
    void this.startBackend(host, backend);

    return id;
  }

  private async startBackend(host: XtermHost, backend: TerminalBackend): Promise<void> {
    try {
      await backend.start();
    } catch (err) {
      host.write(
        `\r\n\x1b[31m[failed to start terminal backend: ${(err as Error).message}]\x1b[0m\r\n`,
      );
    }
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

    this.persistState();

    if (this.tabs.length === 0) {
      this.leaf.detach();
    }
  }

  private persistState(): void {
    // Surface state changes to Obsidian so layout save picks up new tabs.
    const workspace = this.app.workspace as unknown as {
      requestSaveLayout?: () => void;
    };
    workspace.requestSaveLayout?.();
  }

  private removeTabEventHandlers(tab: TerminalTab): void {
    tab.paneEl.removeEventListener("keydown", tab.keydownHandler);
  }

  private coerceSpec(raw: unknown): TerminalTabSpec | null {
    if (!raw || typeof raw !== "object") return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.shell !== "string" || s.shell.length === 0) return null;
    const shellArgs = Array.isArray(s.shellArgs)
      ? (s.shellArgs.filter((v) => typeof v === "string") as string[])
      : undefined;
    const cwd = typeof s.cwd === "string" ? s.cwd : undefined;
    return { shell: s.shell, shellArgs, cwd };
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
