// Rank 3 workspace container — one ItemView leaf, N xterm instances multiplexed in its DOM,
// switched by a vertical side-tab selector. Throwaway spike; do not adopt without the ADR.

import { ItemView, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import * as os from "os";
import { createXtermHost, XtermHost } from "../../../../src/terminal/xterm-host";
import { PtyBackend } from "../../../../src/pty/pty-backend";

export const PROTO_VIEW_TYPE = "anvil-prototype-container-view";

interface ProtoTab {
  id: string;
  label: string;
  host: XtermHost;
  backend: PtyBackend;
  contentEl: HTMLElement;
  tabButtonEl: HTMLElement;
}

export class PrototypeContainerView extends ItemView {
  // Load-bearing R8 mitigation (proven by AC6 bite-check): Obsidian's leaf
  // picker skips non-navigable views when routing default-mode openLinkText.
  // Documented since 0.15.1. Flipping this to true turns R8a red.
  public navigation = false;

  private tabs: ProtoTab[] = [];
  private activeTabId: string | null = null;
  private tabListEl!: HTMLElement;
  private contentAreaEl!: HTMLElement;
  private tabCounter = 0;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.addAction("plus", "New terminal tab", () => {
      void this.addTab();
    });
  }

  getViewType(): string {
    return PROTO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Terminals (Phase 2 prototype)";
  }

  getIcon(): string {
    return "terminal-square";
  }

  async onOpen(): Promise<void> {
    // setPinned(true) was tried as belt-and-suspenders and proven redundant
    // by the AC6 diagnostic runs: with navigation = false already set,
    // removing the setPinned call left all five R8 probes green. Dropping
    // it removes an undocumented-API dependency; the ADR records this.
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("anvil-proto-container");

    this.tabListEl = container.createDiv({ cls: "anvil-proto-tablist" });
    this.contentAreaEl = container.createDiv({ cls: "anvil-proto-content" });

    // Expose the instance on window for R8 probe scripts and sanity checks.
    (window as unknown as { __anvilProto?: PrototypeContainerView }).__anvilProto = this;

    await this.addTab();
  }

  async onClose(): Promise<void> {
    for (const tab of this.tabs) {
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
    const w = window as unknown as { __anvilProto?: PrototypeContainerView };
    if (w.__anvilProto === this) delete w.__anvilProto;
  }

  onResize(): void {
    const active = this.tabs.find((t) => t.id === this.activeTabId);
    active?.host.fit();
  }

  // Exposed for probes + sanity inspection.
  public getTabIds(): string[] {
    return this.tabs.map((t) => t.id);
  }

  public getActiveTabId(): string | null {
    return this.activeTabId;
  }

  public getActiveTabDOMState(): { id: string | null; xtermAttached: boolean; xtermVisible: boolean } {
    const active = this.tabs.find((t) => t.id === this.activeTabId);
    if (!active) return { id: null, xtermAttached: false, xtermVisible: false };
    const xterm = active.contentEl.querySelector(".xterm") as HTMLElement | null;
    return {
      id: active.id,
      xtermAttached: Boolean(xterm),
      xtermVisible: Boolean(xterm && xterm.offsetParent !== null),
    };
  }

  public async addTab(): Promise<void> {
    this.tabCounter += 1;
    const id = `tab-${this.tabCounter}`;
    const label = `Terminal ${this.tabCounter}`;

    const tabButtonEl = this.tabListEl.createDiv({ cls: "anvil-proto-tab", text: label });
    tabButtonEl.addEventListener("click", () => this.switchTab(id));

    const contentEl = this.contentAreaEl.createDiv({ cls: "anvil-proto-pane" });
    contentEl.style.display = "none";

    const host = createXtermHost();
    host.mount(contentEl);

    const backend = new PtyBackend({
      binaryPath: this.resolveBinaryPath(),
      shell: process.env.SHELL || "/bin/zsh",
      cwd: this.resolveVaultRoot(),
      cols: host.terminal.cols,
      rows: host.terminal.rows,
    });

    backend.onData((data) => host.write(data));
    backend.onExit(({ status, signal }) => {
      const detail = signal !== null ? `signal ${signal}` : `status ${status ?? "?"}`;
      host.write(`\r\n\x1b[33m[shell exited: ${detail}]\x1b[0m\r\n`);
    });
    host.onData((data) => backend.write(data));
    host.onResize(({ cols, rows }) => backend.resize(cols, rows));

    const tab: ProtoTab = { id, label, host, backend, contentEl, tabButtonEl };
    this.tabs.push(tab);

    try {
      await backend.start();
    } catch (err) {
      host.write(
        `\r\n\x1b[31m[failed to start pty-server: ${(err as Error).message}]\x1b[0m\r\n`,
      );
    }

    this.switchTab(id);
  }

  public switchTab(id: string): void {
    const incoming = this.tabs.find((t) => t.id === id);
    if (!incoming) return;

    // The critical invariant for AC6: we DO NOT dispose xterms on switch.
    // Every tab's xterm stays mounted in the DOM; we only toggle visibility.
    for (const tab of this.tabs) {
      const isActive = tab.id === id;
      tab.contentEl.style.display = isActive ? "block" : "none";
      tab.tabButtonEl.toggleClass("is-active", isActive);
    }
    this.activeTabId = id;

    requestAnimationFrame(() => {
      incoming.host.fit();
      incoming.host.focus();
    });
  }

  private resolveBinaryPath(): string {
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    const vaultRoot = adapter.basePath ?? "";
    // Reuse the production plugin's Rust pty-server binary. The prototype plugin
    // does not ship its own binary — users must also have the main plugin
    // installed (or the binary copied) per the README.
    return path.join(
      vaultRoot,
      ".obsidian",
      "plugins",
      "anvil-obsidian-terminal",
      "bin",
      "pty-server",
    );
  }

  private resolveVaultRoot(): string {
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    return adapter.basePath ?? os.homedir();
  }
}
