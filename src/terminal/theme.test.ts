import { describe, it, expect } from "vitest";
import {
  deriveXtermTheme,
  SOLARIZED_DARK_FALLBACK,
  CssVarReader,
} from "./theme";

/** A test reader factory: vars is a partial map of CSS-var name → value. */
function makeReader(vars: Record<string, string>): CssVarReader {
  return (name: string) => vars[name] ?? "";
}

describe("deriveXtermTheme", () => {
  // AC1 — derive background/foreground/cursor from Obsidian CSS vars.
  describe("base colors (AC1)", () => {
    it("maps --background-primary to theme.background", () => {
      const theme = deriveXtermTheme({
        read: makeReader({ "--background-primary": "#1e1e1e" }),
        overrides: { solidBackground: false, useObsidianAccents: true },
      });
      // With solidBackground:false, background is the value with alpha 00
      // (transparent overlay) so xterm doesn't paint over Obsidian's
      // background. With solidBackground:true, the raw value is used.
      // For AC1 we just assert non-empty derived value; opacity is AC sub-test.
      expect(typeof theme.background).toBe("string");
      expect(theme.background).not.toBe("");
    });

    it("maps --text-normal to theme.foreground", () => {
      const theme = deriveXtermTheme({
        read: makeReader({ "--text-normal": "#dcdcdc" }),
        overrides: { solidBackground: false, useObsidianAccents: true },
      });
      expect(theme.foreground).toBe("#dcdcdc");
    });

    it("maps --text-accent (or fallback) to theme.cursor", () => {
      const theme = deriveXtermTheme({
        read: makeReader({ "--text-accent": "#aaff00" }),
        overrides: { solidBackground: false, useObsidianAccents: true },
      });
      expect(theme.cursor).toBe("#aaff00");
    });

    it("falls back to a sensible cursor color when --text-accent missing", () => {
      const theme = deriveXtermTheme({
        read: makeReader({ "--text-normal": "#dcdcdc" }),
        overrides: { solidBackground: false, useObsidianAccents: true },
      });
      // Acceptable fallbacks: foreground value or a defined default; just
      // pin that cursor isn't empty (xterm will throw on empty).
      expect(theme.cursor).not.toBe("");
    });
  });

  describe("solidBackground toggle (D5)", () => {
    it("solidBackground:false yields a transparent background overlay", () => {
      // The current pre-Phase-2 hardcoded behaviour was #00000000 (transparent
      // RGBA). The new theme keeps transparency by default to preserve that
      // appearance, so when overrides.solidBackground is false, theme.background
      // ends with an alpha-00 hex.
      const theme = deriveXtermTheme({
        read: makeReader({ "--background-primary": "#1e1e1e" }),
        overrides: { solidBackground: false, useObsidianAccents: true },
      });
      // Hex with alpha 00 — xterm treats this as transparent.
      expect(theme.background).toMatch(/00$/);
    });

    it("solidBackground:true yields the raw --background-primary", () => {
      const theme = deriveXtermTheme({
        read: makeReader({ "--background-primary": "#1e1e1e" }),
        overrides: { solidBackground: true, useObsidianAccents: true },
      });
      expect(theme.background).toBe("#1e1e1e");
    });
  });

  describe("ANSI palette (AC3)", () => {
    it("with useObsidianAccents:true, red derives from --color-red", () => {
      const theme = deriveXtermTheme({
        read: makeReader({
          "--color-red": "#cc0000",
          "--color-green": "#00cc00",
        }),
        overrides: { solidBackground: false, useObsidianAccents: true },
      });
      expect(theme.red).toBe("#cc0000");
      expect(theme.green).toBe("#00cc00");
    });

    it("with useObsidianAccents:false, red equals Solarized Dark red wholesale", () => {
      const theme = deriveXtermTheme({
        read: makeReader({
          "--color-red": "#cc0000",
          "--color-green": "#00cc00",
        }),
        overrides: { solidBackground: false, useObsidianAccents: false },
      });
      expect(theme.red).toBe(SOLARIZED_DARK_FALLBACK.red);
      expect(theme.green).toBe(SOLARIZED_DARK_FALLBACK.green);
    });

    it("Solarized Dark red is #dc322f per spec AC3", () => {
      // Pinning the exact value used in AC3.
      expect(SOLARIZED_DARK_FALLBACK.red).toBe("#dc322f");
    });

    it("falls back to Solarized for any --color-* slot Obsidian doesn't expose", () => {
      // --color-red present, --color-green absent. With useObsidianAccents:true
      // the present slot derives, the absent one falls back per-slot.
      const theme = deriveXtermTheme({
        read: makeReader({ "--color-red": "#cc0000" }),
        overrides: { solidBackground: false, useObsidianAccents: true },
      });
      expect(theme.red).toBe("#cc0000");
      expect(theme.green).toBe(SOLARIZED_DARK_FALLBACK.green);
    });

    it("populates all 8 named ANSI slots either from Obsidian or fallback", () => {
      const theme = deriveXtermTheme({
        read: makeReader({}),
        overrides: { solidBackground: false, useObsidianAccents: true },
      });
      // All 8 named slots must be defined and non-empty.
      for (const slot of [
        "black",
        "red",
        "green",
        "yellow",
        "blue",
        "magenta",
        "cyan",
        "white",
      ] as const) {
        expect(theme[slot], `slot ${slot}`).toBeTruthy();
      }
    });
  });
});
