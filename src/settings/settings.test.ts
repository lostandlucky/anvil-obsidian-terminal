import { describe, it, expect } from "vitest";
import { normalizeSettings, DEFAULT_SETTINGS } from "./settings";

describe("normalizeSettings", () => {
  it("returns defaults when input is undefined", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults when input is null", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults when input is an empty object", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("preserves valid defaultShell string", () => {
    const out = normalizeSettings({ defaultShell: "/bin/zsh" });
    expect(out.defaultShell).toBe("/bin/zsh");
  });

  it("falls back to default when defaultShell is not a string", () => {
    const out = normalizeSettings({ defaultShell: 42 });
    expect(out.defaultShell).toBe(DEFAULT_SETTINGS.defaultShell);
  });

  it("preserves valid userShellList array of strings", () => {
    const out = normalizeSettings({ userShellList: ["/a", "/b"] });
    expect(out.userShellList).toEqual(["/a", "/b"]);
  });

  it("falls back to empty list when userShellList is not an array", () => {
    const out = normalizeSettings({ userShellList: "nope" });
    expect(out.userShellList).toEqual([]);
  });

  it("filters out non-string entries from userShellList", () => {
    const out = normalizeSettings({ userShellList: ["/a", 1, null, "/b"] });
    expect(out.userShellList).toEqual(["/a", "/b"]);
  });

  it("preserves preserveTmuxDimensions when boolean", () => {
    expect(normalizeSettings({ preserveTmuxDimensions: true }).preserveTmuxDimensions).toBe(true);
    expect(normalizeSettings({ preserveTmuxDimensions: false }).preserveTmuxDimensions).toBe(false);
  });

  it("defaults preserveTmuxDimensions to false when missing or wrong type", () => {
    expect(normalizeSettings({}).preserveTmuxDimensions).toBe(false);
    expect(normalizeSettings({ preserveTmuxDimensions: "yes" }).preserveTmuxDimensions).toBe(false);
  });

  it("strips unknown keys", () => {
    const out = normalizeSettings({ defaultShell: "/bin/zsh", extraneous: "x" });
    expect(out).not.toHaveProperty("extraneous");
  });

  it("defaults preserveTmuxDimensions to false", () => {
    expect(DEFAULT_SETTINGS.preserveTmuxDimensions).toBe(false);
  });

  it("defaults userShellList to an empty array", () => {
    expect(DEFAULT_SETTINGS.userShellList).toEqual([]);
  });

  it("defaults defaultShell to an empty string", () => {
    expect(DEFAULT_SETTINGS.defaultShell).toBe("");
  });

  // Phase 2 — new settings fields (AC4).

  describe("fontFamily", () => {
    it("defaults to a nerd-font-prepended stack (D3)", () => {
      // The stack must put common nerd fonts ahead of a hardcoded monospace
      // fallback so users with a nerd font installed get glyphs without
      // configuring anything; users without one fall through to a system
      // monospace. CSS `var(...)` references are not used because xterm.js
      // sets the family on a Canvas context, which doesn't resolve them.
      expect(DEFAULT_SETTINGS.fontFamily).toMatch(/Nerd Font|MesloLGS NF/);
      expect(DEFAULT_SETTINGS.fontFamily.indexOf("Nerd Font") >= 0 || DEFAULT_SETTINGS.fontFamily.indexOf("MesloLGS NF") >= 0).toBe(true);
      expect(DEFAULT_SETTINGS.fontFamily).toMatch(/Menlo|Monaco|monospace/);
      expect(DEFAULT_SETTINGS.fontFamily).not.toContain("var(");
    });

    it("preserves a valid fontFamily string", () => {
      const out = normalizeSettings({ fontFamily: "'MesloLGS NF', monospace" });
      expect(out.fontFamily).toBe("'MesloLGS NF', monospace");
    });

    it("falls back to default when fontFamily is not a string", () => {
      const out = normalizeSettings({ fontFamily: 42 });
      expect(out.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
    });
  });

  describe("fontSize", () => {
    it("defaults to 13", () => {
      expect(DEFAULT_SETTINGS.fontSize).toBe(13);
    });

    it("preserves a valid fontSize number", () => {
      const out = normalizeSettings({ fontSize: 16 });
      expect(out.fontSize).toBe(16);
    });

    it("falls back to default when fontSize is not a number", () => {
      const out = normalizeSettings({ fontSize: "16" });
      expect(out.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    });

    it("falls back to default when fontSize is NaN", () => {
      const out = normalizeSettings({ fontSize: NaN });
      expect(out.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    });
  });

  describe("tmuxSessionNameFormat", () => {
    it("defaults to 'integer'", () => {
      expect(DEFAULT_SETTINGS.tmuxSessionNameFormat).toBe("integer");
    });

    it("preserves 'integer'", () => {
      const out = normalizeSettings({ tmuxSessionNameFormat: "integer" });
      expect(out.tmuxSessionNameFormat).toBe("integer");
    });

    it("preserves 'obsidian-prefix'", () => {
      const out = normalizeSettings({ tmuxSessionNameFormat: "obsidian-prefix" });
      expect(out.tmuxSessionNameFormat).toBe("obsidian-prefix");
    });

    it("falls back to default for unknown strings", () => {
      const out = normalizeSettings({ tmuxSessionNameFormat: "weird" });
      expect(out.tmuxSessionNameFormat).toBe("integer");
    });

    it("falls back to default when not a string", () => {
      const out = normalizeSettings({ tmuxSessionNameFormat: 42 });
      expect(out.tmuxSessionNameFormat).toBe("integer");
    });
  });

  describe("themeOverrides", () => {
    it("defaults solidBackground to false", () => {
      expect(DEFAULT_SETTINGS.themeOverrides.solidBackground).toBe(false);
    });

    it("defaults useObsidianAccents to true", () => {
      expect(DEFAULT_SETTINGS.themeOverrides.useObsidianAccents).toBe(true);
    });

    it("preserves explicit themeOverrides booleans", () => {
      const out = normalizeSettings({
        themeOverrides: { solidBackground: true, useObsidianAccents: false },
      });
      expect(out.themeOverrides.solidBackground).toBe(true);
      expect(out.themeOverrides.useObsidianAccents).toBe(false);
    });

    it("falls back to defaults when themeOverrides is missing", () => {
      const out = normalizeSettings({});
      expect(out.themeOverrides.solidBackground).toBe(false);
      expect(out.themeOverrides.useObsidianAccents).toBe(true);
    });

    it("falls back to defaults when themeOverrides is the wrong shape", () => {
      const out = normalizeSettings({ themeOverrides: "nope" });
      expect(out.themeOverrides.solidBackground).toBe(false);
      expect(out.themeOverrides.useObsidianAccents).toBe(true);
    });

    it("recovers individual fields when sub-fields are wrong type", () => {
      const out = normalizeSettings({
        themeOverrides: { solidBackground: "yes", useObsidianAccents: 0 },
      });
      expect(out.themeOverrides.solidBackground).toBe(false);
      expect(out.themeOverrides.useObsidianAccents).toBe(true);
    });

    it("leaves room for a future themeOverrides.ansi field without breaking", () => {
      // D5: schema must accommodate per-color overrides as a future addition
      // without breaking normalizeSettings. We don't ship UI for it here, but
      // an unknown ansi field on the input should not crash and should not
      // contaminate the output.
      const out = normalizeSettings({
        themeOverrides: {
          solidBackground: true,
          useObsidianAccents: false,
          ansi: { red: "#ff0000" },
        },
      });
      expect(out.themeOverrides.solidBackground).toBe(true);
      expect(out.themeOverrides.useObsidianAccents).toBe(false);
      // ansi may be carried through (typed shape) or stripped — both are
      // acceptable. This test pins that the call doesn't throw.
    });
  });
});
