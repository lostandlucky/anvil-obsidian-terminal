// Pure spec layer for the settings tab. No `obsidian` import — buildable
// from unit tests, then mapped to Setting/ToggleComponent in settings-tab.ts.
//
// Why this exists: Setting()/ToggleComponent are runtime classes from
// obsidian.js (the actual app), not the @types/obsidian package. Unit tests
// can't construct them. Splitting the spec list out lets us pin AC5 (each
// control updates the underlying setting via host.updateSettings) without
// reaching for jsdom + an Obsidian shim.

import { AnvilSettings } from "./settings";

export interface SettingsTabHost {
  // App is opaque to the spec layer — kept here so the tab can satisfy its
  // PluginSettingTab parent. Spec consumers don't read it.
  app: unknown;
  getSettings(): AnvilSettings;
  updateSettings(patch: Partial<AnvilSettings>): Promise<void>;
}

export type SettingControlSpec =
  | {
      kind: "text";
      name: string;
      desc: string;
      placeholder?: string;
      multiline?: boolean;
      getValue: () => string;
      setValue: (value: string) => Promise<void>;
    }
  | {
      kind: "toggle";
      name: string;
      desc: string;
      getValue: () => boolean;
      setValue: (value: boolean) => Promise<void>;
    }
  | {
      kind: "dropdown";
      name: string;
      desc: string;
      options: Record<string, string>; // value -> display label
      getValue: () => string;
      setValue: (value: string) => Promise<void>;
    };

export function buildSettingsControlSpecs(
  host: SettingsTabHost,
): SettingControlSpec[] {
  return [
    {
      kind: "text",
      name: "Default shell",
      desc:
        "Resolved path of the shell launched by default (plus-icon, picker Enter on the default row). Leave empty to fall back to $SHELL.",
      placeholder: "/bin/zsh",
      getValue: () => host.getSettings().defaultShell,
      setValue: async (value) => {
        await host.updateSettings({ defaultShell: value.trim() });
      },
    },
    {
      kind: "text",
      name: "Additional shells",
      desc:
        "Extra shell paths to include in the picker, one per line. Only paths that exist on disk are shown.",
      placeholder: "/opt/homebrew/bin/fish\n/usr/local/bin/nu",
      multiline: true,
      getValue: () => host.getSettings().userShellList.join("\n"),
      setValue: async (value) => {
        const list = value
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        await host.updateSettings({ userShellList: list });
      },
    },
    {
      kind: "toggle",
      name: "Preserve tmux session dimensions on attach",
      desc:
        "When off (default), attaching to a tmux session resizes it to match the pane. When on, the session keeps its current dimensions (-x/-y passed to tmux).",
      getValue: () => host.getSettings().preserveTmuxDimensions,
      setValue: async (value) => {
        await host.updateSettings({ preserveTmuxDimensions: value });
      },
    },
    {
      kind: "text",
      name: "Font family",
      desc:
        "CSS font-family stack used by the terminal. Default prepends common nerd fonts so installed nerd fonts render glyphs without configuration.",
      placeholder: "'MesloLGS Nerd Font Mono', monospace",
      getValue: () => host.getSettings().fontFamily,
      setValue: async (value) => {
        await host.updateSettings({ fontFamily: value });
      },
    },
    {
      kind: "text",
      name: "Font size",
      desc: "Terminal font size in pixels.",
      placeholder: "13",
      getValue: () => String(host.getSettings().fontSize),
      setValue: async (value) => {
        const n = Number.parseFloat(value);
        if (!Number.isFinite(n) || n <= 0) return;
        await host.updateSettings({ fontSize: n });
      },
    },
    {
      kind: "dropdown",
      name: "Tmux session name format",
      desc:
        "How new tmux sessions are named when launched from the picker. 'integer' lets tmux assign auto-incrementing integer names (current behavior). 'obsidian-prefix' uses obsidian-N.",
      options: {
        integer: "Integer (tmux default)",
        "obsidian-prefix": "obsidian-N (auto-incremented)",
      },
      getValue: () => host.getSettings().tmuxSessionNameFormat,
      setValue: async (value) => {
        if (value === "integer" || value === "obsidian-prefix") {
          await host.updateSettings({ tmuxSessionNameFormat: value });
        }
      },
    },
    {
      kind: "toggle",
      name: "Solid background",
      desc:
        "When off (default), the terminal background is transparent so Obsidian's pane background shows through. When on, the background is opaque (Obsidian's --background-primary).",
      getValue: () => host.getSettings().themeOverrides.solidBackground,
      setValue: async (value) => {
        const current = host.getSettings().themeOverrides;
        await host.updateSettings({
          themeOverrides: { ...current, solidBackground: value },
        });
      },
    },
    {
      kind: "toggle",
      name: "Use Obsidian accents",
      desc:
        "When on (default), the terminal's ANSI 16-color palette derives from Obsidian's --color-* variables. When off, falls back to a curated Solarized Dark palette wholesale.",
      getValue: () => host.getSettings().themeOverrides.useObsidianAccents,
      setValue: async (value) => {
        const current = host.getSettings().themeOverrides;
        await host.updateSettings({
          themeOverrides: { ...current, useObsidianAccents: value },
        });
      },
    },
  ];
}
