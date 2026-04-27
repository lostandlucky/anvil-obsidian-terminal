export type TmuxSessionNameFormat = "integer" | "obsidian-prefix";

export interface ThemeOverrides {
  /** When true, the terminal background is opaque rather than transparent. */
  solidBackground: boolean;
  /** When true (default), ANSI palette derives from Obsidian --color-*
   *  variables; when false, falls back wholesale to a curated Solarized Dark
   *  palette. (D5/R3.) */
  useObsidianAccents: boolean;
  /** Reserved for future per-color overrides (D5). The schema carries this
   *  field shape so a later phase can ship the UI without breaking the
   *  serialized format. */
  ansi?: Partial<Record<string, string>>;
}

export interface AnvilSettings {
  defaultShell: string;
  userShellList: string[];
  preserveTmuxDimensions: boolean;
  /** xterm fontFamily CSS string. Default is the nerd-font-prepended stack
   *  (D3) so users with a nerd font installed get glyphs by default. */
  fontFamily: string;
  /** xterm fontSize in CSS pixels. */
  fontSize: number;
  /** Picker behaviour for `new-tmux`: integer (tmux's auto-naming, current
   *  behaviour) or `obsidian-N` auto-incremented prefix. (D4/R5.) */
  tmuxSessionNameFormat: TmuxSessionNameFormat;
  themeOverrides: ThemeOverrides;
}

const NERD_FONT_STACK =
  "'MesloLGS NF', 'FiraCode Nerd Font', 'JetBrainsMono Nerd Font', " +
  "var(--font-monospace), Menlo, Monaco, 'Courier New', monospace";

export const DEFAULT_SETTINGS: AnvilSettings = {
  defaultShell: "",
  userShellList: [],
  preserveTmuxDimensions: false,
  fontFamily: NERD_FONT_STACK,
  fontSize: 13,
  tmuxSessionNameFormat: "integer",
  themeOverrides: {
    solidBackground: false,
    useObsidianAccents: true,
  },
};

function normalizeThemeOverrides(input: unknown): ThemeOverrides {
  const src = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const out: ThemeOverrides = {
    solidBackground:
      typeof src.solidBackground === "boolean"
        ? src.solidBackground
        : DEFAULT_SETTINGS.themeOverrides.solidBackground,
    useObsidianAccents:
      typeof src.useObsidianAccents === "boolean"
        ? src.useObsidianAccents
        : DEFAULT_SETTINGS.themeOverrides.useObsidianAccents,
  };
  // ansi is reserved future surface (D5). Carry it through only if it's a
  // plain object whose values are strings; otherwise drop it silently.
  if (src.ansi && typeof src.ansi === "object" && !Array.isArray(src.ansi)) {
    const ansi: Record<string, string> = {};
    for (const [k, v] of Object.entries(src.ansi as Record<string, unknown>)) {
      if (typeof v === "string") ansi[k] = v;
    }
    if (Object.keys(ansi).length > 0) out.ansi = ansi;
  }
  return out;
}

export function normalizeSettings(input: unknown): AnvilSettings {
  const src = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;

  const defaultShell =
    typeof src.defaultShell === "string"
      ? src.defaultShell
      : DEFAULT_SETTINGS.defaultShell;

  const userShellList = Array.isArray(src.userShellList)
    ? (src.userShellList.filter((s) => typeof s === "string") as string[])
    : [...DEFAULT_SETTINGS.userShellList];

  const preserveTmuxDimensions =
    typeof src.preserveTmuxDimensions === "boolean"
      ? src.preserveTmuxDimensions
      : DEFAULT_SETTINGS.preserveTmuxDimensions;

  const fontFamily =
    typeof src.fontFamily === "string"
      ? src.fontFamily
      : DEFAULT_SETTINGS.fontFamily;

  const fontSize =
    typeof src.fontSize === "number" && Number.isFinite(src.fontSize)
      ? src.fontSize
      : DEFAULT_SETTINGS.fontSize;

  const tmuxSessionNameFormat: TmuxSessionNameFormat =
    src.tmuxSessionNameFormat === "integer" ||
    src.tmuxSessionNameFormat === "obsidian-prefix"
      ? src.tmuxSessionNameFormat
      : DEFAULT_SETTINGS.tmuxSessionNameFormat;

  const themeOverrides = normalizeThemeOverrides(src.themeOverrides);

  return {
    defaultShell,
    userShellList,
    preserveTmuxDimensions,
    fontFamily,
    fontSize,
    tmuxSessionNameFormat,
    themeOverrides,
  };
}
