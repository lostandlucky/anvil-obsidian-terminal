import { ItemView, Plugin, ViewStateResult, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import * as os from "os";
import { createXtermHost, XtermHost } from "../terminal/xterm-host";
import { PtyBackend } from "../pty/pty-backend";
import { TerminalBackend } from "../pty/terminal-backend";

export const TERMINAL_VIEW_TYPE = "obsidian-terminal-view";

interface TerminalLaunchState {
  shell?: string;
  shellArgs?: string[];
  cwd?: string;
}

interface HostPlugin extends Plugin {
  getDefaultShell?: () => string;
  openDefaultTerminal?: () => Promise<void> | void;
  consumePendingSpec?: (leaf: WorkspaceLeaf) => TerminalLaunchState | null;
}

export class TerminalView extends ItemView {
  private host: XtermHost | null = null;
  private backend: TerminalBackend | null = null;
  private containerKeydownHandler: ((ev: KeyboardEvent) => void) | null = null;
  private launchState: TerminalLaunchState = {};

  constructor(leaf: WorkspaceLeaf, private readonly plugin: HostPlugin) {
    super(leaf);
    this.addAction("plus", "New terminal", () => {
      void this.plugin.openDefaultTerminal?.();
    });
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state && typeof state === "object") {
      const s = state as Record<string, unknown>;
      this.launchState = {
        shell: typeof s.shell === "string" ? s.shell : undefined,
        shellArgs: Array.isArray(s.shellArgs)
          ? (s.shellArgs.filter((v) => typeof v === "string") as string[])
          : undefined,
        cwd: typeof s.cwd === "string" ? s.cwd : undefined,
      };
    }
    await super.setState(state, result);
  }

  getState(): Record<string, unknown> {
    const base = (super.getState() ?? {}) as Record<string, unknown>;
    return {
      ...base,
      shell: this.launchState.shell,
      shellArgs: this.launchState.shellArgs,
      cwd: this.launchState.cwd,
    };
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

    const pending = this.plugin.consumePendingSpec?.(this.leaf) ?? null;
    const resolvedShell =
      pending?.shell ?? this.launchState.shell ?? this.detectShell();
    const resolvedCwd =
      pending?.cwd ?? this.launchState.cwd ?? this.resolveVaultRoot();
    const resolvedShellArgs = pending?.shellArgs ?? this.launchState.shellArgs;

    const backend = new PtyBackend({
      binaryPath: this.resolveBinaryPath(),
      shell: resolvedShell,
      cwd: resolvedCwd,
      cols: host.terminal.cols,
      rows: host.terminal.rows,
      shellArgs: resolvedShellArgs,
    });
    this.backend = backend;

    backend.onData((data) => host.write(data));
    backend.onExit(({ status, signal }) => {
      const detail = signal !== null ? `signal ${signal}` : `status ${status ?? "?"}`;
      host.write(`\r\n\x1b[33m[shell exited: ${detail}]\x1b[0m\r\n`);
    });
    host.onData((data) => backend.write(data));
    host.onResize(({ cols, rows }) => backend.resize(cols, rows));

    // FI-007: stop Ctrl bubbling so Obsidian's keymap doesn't fire after xterm processes the key. Cmd left alone so the command palette still works.
    this.containerKeydownHandler = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && !ev.metaKey) {
        ev.stopPropagation();
      }
    };
    container.addEventListener("keydown", this.containerKeydownHandler);

    requestAnimationFrame(() => host.fit());
    host.focus();

    // Start the backend after the keydown handler is in place so a slow handshake can't race the user's first keystroke.
    try {
      await backend.start();
    } catch (err) {
      host.write(
        `\r\n\x1b[31m[failed to start terminal backend: ${
          (err as Error).message
        }]\x1b[0m\r\n`,
      );
    }
  }

  async onClose(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement | undefined;
    if (container && this.containerKeydownHandler) {
      container.removeEventListener("keydown", this.containerKeydownHandler);
    }
    this.containerKeydownHandler = null;

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
