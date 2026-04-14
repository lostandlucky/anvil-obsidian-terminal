import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export interface XtermHost {
  readonly terminal: Terminal;
  mount(container: HTMLElement): void;
  write(data: string): void;
  onData(handler: (data: string) => void): void;
  onResize(handler: (size: { cols: number; rows: number }) => void): void;
  fit(): void;
  focus(): void;
  dispose(): void;
}

export function createXtermHost(): XtermHost {
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily:
      "var(--font-monospace), Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
    allowProposedApi: true,
    theme: {
      background: "#00000000",
      foreground: "#e0e0e0",
      cursor: "#e0e0e0",
    },
  });

  const fit = new FitAddon();
  terminal.loadAddon(fit);

  let resizeObserver: ResizeObserver | null = null;
  let mountEl: HTMLElement | null = null;

  return {
    terminal,
    mount(container) {
      mountEl = container;
      terminal.open(container);
      try {
        fit.fit();
      } catch {
        /* container may be zero-sized on first paint */
      }
      resizeObserver = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      });
      resizeObserver.observe(container);
    },
    write(data) {
      terminal.write(data);
    },
    onData(handler) {
      terminal.onData(handler);
    },
    onResize(handler) {
      terminal.onResize(({ cols, rows }) => handler({ cols, rows }));
    },
    fit() {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    },
    focus() {
      terminal.focus();
    },
    dispose() {
      if (resizeObserver && mountEl) {
        resizeObserver.unobserve(mountEl);
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      terminal.dispose();
    },
  };
}
