// Derive xterm theme from Obsidian CSS variables (FI-016 / AC1, AC3).
//
// Pure module — no `obsidian` import, no DOM. Callers (xterm-host) supply a
// CssVarReader that knows how to read computed-style values from a real
// element; tests inject a synthetic reader.

import type { ITheme } from "@xterm/xterm";
import type { ThemeOverrides } from "../settings/settings";

export type CssVarReader = (name: string) => string;

export interface DeriveThemeInput {
  read: CssVarReader;
  overrides: Pick<ThemeOverrides, "solidBackground" | "useObsidianAccents">;
}

/** Solarized Dark fallback for ANSI slots Obsidian doesn't expose. Also the
 *  wholesale palette when useObsidianAccents is false (D5/AC3). */
export const SOLARIZED_DARK_FALLBACK = {
  black: "#073642",
  red: "#dc322f",
  green: "#859900",
  yellow: "#b58900",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#2aa198",
  white: "#eee8d5",
  brightBlack: "#002b36",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
} as const;

const ANSI_SLOTS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

type AnsiSlot = (typeof ANSI_SLOTS)[number];

/** Map a CSS hex (#rrggbb) to its alpha-00 form so xterm treats it as
 *  transparent. xterm reads its alpha from the trailing two hex digits when
 *  the color is supplied as #rrggbbaa. (The pre-Phase-2 hardcoded background
 *  was #00000000 — same family of value.) */
function withAlpha00(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return `${trimmed}00`;
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 7)}00`;
  }
  // Non-hex (rgb(), named) — fall back to the original token. xterm will
  // accept it but won't be transparent; this is best-effort for users with
  // exotic themes.
  return trimmed;
}

export function deriveXtermTheme(input: DeriveThemeInput): ITheme {
  const { read, overrides } = input;

  const bgRaw = read("--background-primary").trim() || "#1e1e1e";
  const fg = read("--text-normal").trim() || "#dcdcdc";
  const cursorRaw = read("--text-accent").trim();
  const cursor = cursorRaw || fg;

  const background = overrides.solidBackground ? bgRaw : withAlpha00(bgRaw);

  const palette: Partial<Record<AnsiSlot, string>> = {};
  for (const slot of ANSI_SLOTS) {
    if (overrides.useObsidianAccents) {
      const fromObsidian = read(`--color-${slot}`).trim();
      palette[slot] = fromObsidian || SOLARIZED_DARK_FALLBACK[slot];
    } else {
      palette[slot] = SOLARIZED_DARK_FALLBACK[slot];
    }
  }

  return {
    background,
    foreground: fg,
    cursor,
    cursorAccent: bgRaw,
    selectionBackground: read("--text-selection").trim() || undefined,
    black: palette.black,
    red: palette.red,
    green: palette.green,
    yellow: palette.yellow,
    blue: palette.blue,
    magenta: palette.magenta,
    cyan: palette.cyan,
    white: palette.white,
    brightBlack: SOLARIZED_DARK_FALLBACK.brightBlack,
    brightRed: SOLARIZED_DARK_FALLBACK.brightRed,
    brightGreen: SOLARIZED_DARK_FALLBACK.brightGreen,
    brightYellow: SOLARIZED_DARK_FALLBACK.brightYellow,
    brightBlue: SOLARIZED_DARK_FALLBACK.brightBlue,
    brightMagenta: SOLARIZED_DARK_FALLBACK.brightMagenta,
    brightCyan: SOLARIZED_DARK_FALLBACK.brightCyan,
    brightWhite: SOLARIZED_DARK_FALLBACK.brightWhite,
  };
}

/** Build a CssVarReader bound to a specific HTMLElement using the document's
 *  computed style. Production code uses this; tests use a synthetic reader. */
export function createElementCssVarReader(el: HTMLElement): CssVarReader {
  return (name: string) => {
    try {
      return window.getComputedStyle(el).getPropertyValue(name);
    } catch {
      return "";
    }
  };
}
