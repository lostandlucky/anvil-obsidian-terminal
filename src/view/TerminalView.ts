import { ItemView, WorkspaceLeaf } from "obsidian";
import { createXtermHost, XtermHost } from "../terminal/xterm-host";
import { runCommand, welcome } from "../terminal/mock-repl";

export const TERMINAL_VIEW_TYPE = "obsidian-terminal-view";

export class TerminalView extends ItemView {
  private host: XtermHost | null = null;
  private buffer = "";
  private keydownCapture: ((ev: KeyboardEvent) => void) | null = null;

  constructor(leaf: WorkspaceLeaf) {
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
    host.write(welcome());

    host.onData((data) => this.handleInput(data));

    this.keydownCapture = (ev: KeyboardEvent) => {
      if (!container.contains(ev.target as Node)) return;
      ev.stopPropagation();
    };
    this.containerEl.ownerDocument.addEventListener(
      "keydown",
      this.keydownCapture,
      true,
    );

    requestAnimationFrame(() => host.fit());
    host.focus();
  }

  async onClose(): Promise<void> {
    if (this.keydownCapture) {
      this.containerEl.ownerDocument.removeEventListener(
        "keydown",
        this.keydownCapture,
        true,
      );
      this.keydownCapture = null;
    }
    this.host?.dispose();
    this.host = null;
    this.buffer = "";
  }

  onResize(): void {
    this.host?.fit();
  }

  private handleInput(data: string): void {
    if (!this.host) return;
    for (const ch of data) {
      const code = ch.charCodeAt(0);
      if (ch === "\r") {
        const result = runCommand(this.buffer);
        this.buffer = "";
        this.host.write(result.output);
      } else if (code === 0x7f || code === 0x08) {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          this.host.write("\b \b");
        }
      } else if (code === 0x03) {
        this.buffer = "";
        this.host.write("^C\r\n");
        this.host.write("\x1b[32mmock>\x1b[0m ");
      } else if (code >= 0x20 && code !== 0x7f) {
        this.buffer += ch;
        this.host.write(ch);
      }
    }
  }
}
