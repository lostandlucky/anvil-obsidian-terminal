import { ItemView, Plugin, Scope, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import * as os from "os";
import { createXtermHost, XtermHost } from "../terminal/xterm-host";
import { PtyBackend } from "../pty/pty-backend";
import { TerminalBackend } from "../pty/terminal-backend";

export const TERMINAL_VIEW_TYPE = "obsidian-terminal-view";

export class TerminalView extends ItemView {
  private host: XtermHost | null = null;
  private backend: TerminalBackend | null = null;
  private terminalScope: Scope | null = null;
  private scopePushed = false;
  private focusInHandler: ((ev: FocusEvent) => void) | null = null;
  private focusOutHandler: ((ev: FocusEvent) => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: Plugin) {
    super(leaf);
  }

  getViewType(): string {
    return TERMINAL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Terminal";
  }

  getIcon(): string {
    return "terminal-square";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("obsidian-terminal-view");

    const host = createXtermHost();
    this.host = host;
    host.mount(container);

    const backend = new PtyBackend({
      binaryPath: this.resolveBinaryPath(),
      shell: this.detectShell(),
      cwd: this.resolveVaultRoot(),
      cols: host.terminal.cols,
      rows: host.terminal.rows,
    });
    this.backend = backend;

    backend.onData((data) => host.write(data));
    backend.onExit(({ status, signal }) => {
      const detail = signal !== null ? `signal ${signal}` : `status ${status ?? "?"}`;
      host.write(`\r\n\x1b[33m[shell exited: ${detail}]\x1b[0m\r\n`);
    });
    host.onData((data) => backend.write(data));
    host.onResize(({ cols, rows }) => backend.resize(cols, rows));

    try {
      await backend.start();
    } catch (err) {
      host.write(
        `\r\n\x1b[31m[failed to start terminal backend: ${
          (err as Error).message
        }]\x1b[0m\r\n`,
      );
    }

    this.terminalScope = new Scope(this.app.scope);
    const swallow = () => false;
    for (const mods of [
      ["Mod"],
      ["Mod", "Shift"],
      ["Mod", "Alt"],
      ["Mod", "Shift", "Alt"],
      ["Ctrl"],
      ["Ctrl", "Shift"],
      ["Ctrl", "Alt"],
      ["Alt"],
    ] as const) {
      this.terminalScope.register([...mods], null, swallow);
    }

    const pushScope = () => {
      if (!this.scopePushed && this.terminalScope) {
        this.app.keymap.pushScope(this.terminalScope);
        this.scopePushed = true;
      }
    };
    const popScope = () => {
      if (this.scopePushed && this.terminalScope) {
        this.app.keymap.popScope(this.terminalScope);
        this.scopePushed = false;
      }
    };

    this.focusInHandler = (ev: FocusEvent) => {
      if (container.contains(ev.target as Node)) pushScope();
    };
    this.focusOutHandler = (ev: FocusEvent) => {
      const next = ev.relatedTarget as Node | null;
      if (!next || !container.contains(next)) popScope();
    };
    container.addEventListener("focusin", this.focusInHandler);
    container.addEventListener("focusout", this.focusOutHandler);

    requestAnimationFrame(() => host.fit());
    host.focus();
  }

  async onClose(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement | undefined;
    if (container && this.focusInHandler) {
      container.removeEventListener("focusin", this.focusInHandler);
    }
    if (container && this.focusOutHandler) {
      container.removeEventListener("focusout", this.focusOutHandler);
    }
    this.focusInHandler = null;
    this.focusOutHandler = null;

    if (this.scopePushed && this.terminalScope) {
      this.app.keymap.popScope(this.terminalScope);
      this.scopePushed = false;
    }
    this.terminalScope = null;

    if (this.backend) {
      await this.backend.close();
      this.backend = null;
    }
    this.host?.dispose();
    this.host = null;
  }

  onResize(): void {
    this.host?.fit();
  }

  private resolveBinaryPath(): string {
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    const vaultRoot = adapter.basePath ?? "";
    const manifest = this.plugin.manifest;
    const dir = manifest.dir ?? path.join(".obsidian", "plugins", manifest.id);
    return path.join(vaultRoot, dir, "pty-server");
  }

  private resolveVaultRoot(): string {
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    return adapter.basePath ?? os.homedir();
  }

  private detectShell(): string {
    return process.env.SHELL || "/bin/zsh";
  }
}
