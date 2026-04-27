import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createFitCoalescer } from "./fit-coalescer";

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

  // FI-019: coalesce redundant fits. mount() fits unconditionally and
  // records dimensions; the ResizeObserver's initial-observation fire
  // (which carries the same dimensions) is then suppressed. Genuine
  // resizes still flow through.
  const coalescer = createFitCoalescer();

  let resizeObserver: ResizeObserver | null = null;
  let mountEl: HTMLElement | null = null;

  const tryFitForDimensions = (width: number, height: number): void => {
    if (!coalescer.shouldFit({ width, height })) return;
    try {
      fit.fit();
    } catch {
      /* container may be zero-sized on first paint, or dispose mid-flight */
    }
  };

  return {
    terminal,
    mount(container) {
      mountEl = container;
      terminal.open(container);
      tryFitForDimensions(container.clientWidth, container.clientHeight);
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const rect = entry.contentRect;
          tryFitForDimensions(rect.width, rect.height);
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
