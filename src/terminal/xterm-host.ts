import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { createFitCoalescer } from "./fit-coalescer";
import { tryLoadWebgl } from "./webgl-loader";

export interface XtermHost {
  readonly terminal: Terminal;
  mount(container: HTMLElement): void;
  write(data: string): void;
  onData(handler: (data: string) => void): void;
  onResize(handler: (size: { cols: number; rows: number }) => void): void;
  fit(): void;
  focus(): void;
  /** Update the running terminal's theme (R10). Caller is responsible for
   *  invoking fit() afterwards if the theme change shifts cell metrics. */
  applyTheme(theme: ITheme): void;
  /** Update the running terminal's fontFamily (R10). Cell metrics may shift;
   *  caller should invoke fit() to reflow. (Per Phase 1 downstream note: the
   *  public fit() method bypasses the coalescer's dimension-equality short
   *  circuit.) */
  applyFontFamily(fontFamily: string): void;
  /** Update the running terminal's fontSize (R10). See applyFontFamily. */
  applyFontSize(fontSize: number): void;
  dispose(): void;
}

export interface XtermHostOptions {
  /** Initial fontFamily. Defaults to a nerd-font-prepended stack so glyphs
   *  render when a nerd-font is installed (D3/FI-021). */
  fontFamily?: string;
  /** Initial fontSize. Defaults to 13. */
  fontSize?: number;
  /** Initial theme. When omitted, the terminal opens with a transparent
   *  background and a light foreground (legacy fallback for tests/spikes). */
  theme?: ITheme;
}

// Mirror of NERD_FONT_STACK in src/settings/settings.ts — duplicated so
// xterm-host stays decoupled from the settings module. Update both when the
// stack changes. No `var(...)` — Canvas font parser doesn't resolve CSS vars.
const DEFAULT_FONT_FAMILY =
  "'MesloLGS Nerd Font Mono', 'MesloLGS NF', " +
  "'FiraCode Nerd Font Mono', 'FiraCode NF', " +
  "'JetBrainsMono Nerd Font Mono', 'JetBrainsMono NF', " +
  "'Hack Nerd Font Mono', " +
  "Menlo, Monaco, 'Courier New', " +
  "'Symbols Nerd Font Mono', monospace";

const DEFAULT_THEME: ITheme = {
  background: "#00000000",
  foreground: "#e0e0e0",
  cursor: "#e0e0e0",
};

export function createXtermHost(options: XtermHostOptions = {}): XtermHost {
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: options.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontSize: options.fontSize ?? 13,
    allowProposedApi: true,
    theme: options.theme ?? DEFAULT_THEME,
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
      // Phase 1 (glyph-rendering): switch from xterm's silent DOM fallback to
      // WebGL. Must run AFTER terminal.open(element). Init failure or
      // context loss falls through to DOM (D2/D3) without crashing.
      tryLoadWebgl({ terminal, factory: () => new WebglAddon() });
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
    applyTheme(theme) {
      terminal.options.theme = theme;
    },
    applyFontFamily(fontFamily) {
      terminal.options.fontFamily = fontFamily;
    },
    applyFontSize(fontSize) {
      terminal.options.fontSize = fontSize;
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
