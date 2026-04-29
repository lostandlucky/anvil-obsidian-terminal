// Phase 1 (glyph-rendering) — WebGL renderer load path with graceful-degrade.
// Extracted from xterm-host.ts so the load logic is unit-testable without a
// real DOM or WebGL context (jsdom can't do either). The seam is the addon
// factory: production passes `() => new WebglAddon()`; tests pass a stub.

import type { ITerminalAddon, Terminal } from "@xterm/xterm";

const ADDON_ID = "@xterm/addon-webgl";

export type WebglLoaderTerminal = Pick<Terminal, "loadAddon">;

/** Minimum surface of WebglAddon we depend on. Extends ITerminalAddon so a
 *  real Terminal.loadAddon accepts it; adds the onContextLoss event the
 *  WebGL addon exposes (event APIs are subscribed by being called). */
export interface WebglLoaderAddon extends ITerminalAddon {
  onContextLoss(handler: () => void): unknown;
  dispose(): void;
}

export interface WebglLoaderDeps {
  terminal: WebglLoaderTerminal;
  factory: () => WebglLoaderAddon;
  /** Defaults to console.warn. Injectable for tests. */
  warn?: (message: string) => void;
}

export interface WebglLoadResult {
  addon: WebglLoaderAddon;
}

/** Try to construct and activate the WebGL addon on the supplied terminal.
 *  Wires onContextLoss → addon.dispose() per the addon docs. On any failure
 *  (factory throw or terminal.loadAddon throw), warns once and returns null
 *  so the caller falls back to the DOM default. */
export function tryLoadWebgl(deps: WebglLoaderDeps): WebglLoadResult | null {
  const warn = deps.warn ?? ((msg: string) => console.warn(msg));
  let addon: WebglLoaderAddon;
  try {
    addon = deps.factory();
  } catch (err) {
    warn(formatWarning(err));
    return null;
  }
  try {
    deps.terminal.loadAddon(addon);
  } catch (err) {
    warn(formatWarning(err));
    return null;
  }
  addon.onContextLoss(() => addon.dispose());
  return { addon };
}

function formatWarning(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `[anvil-obsidian-terminal] ${ADDON_ID} failed to initialize, falling back to DOM renderer: ${detail}`;
}
