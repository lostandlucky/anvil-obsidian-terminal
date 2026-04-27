// Phase 2 — verify xterm-host factory accepts font + theme config and
// exposes applyTheme without widening the TerminalBackend interface.
//
// These run under vitest with the jsdom-like default environment that ships
// with the project. xterm.js's open() relies on layout APIs that don't run
// without a real DOM, so we don't call mount(); we just inspect terminal.options.

import { describe, it, expect } from "vitest";
import { createXtermHost } from "./xterm-host";
import { deriveXtermTheme } from "./theme";

describe("createXtermHost — Phase 2 factory params", () => {
  describe("AC8 — fontFamily round-trip", () => {
    it("default fontFamily is the nerd-font-prepended stack (D3)", () => {
      const host = createXtermHost();
      // Default stack must put nerd fonts ahead of var(--font-monospace).
      const ff = host.terminal.options.fontFamily ?? "";
      expect(ff).toMatch(/Nerd Font|MesloLGS NF/);
      expect(ff).toContain("var(--font-monospace)");
      host.dispose();
    });

    it("accepts a fontFamily override and propagates to terminal.options", () => {
      const host = createXtermHost({ fontFamily: "'MesloLGS NF', monospace" });
      expect(host.terminal.options.fontFamily).toBe("'MesloLGS NF', monospace");
      host.dispose();
    });
  });

  describe("AC8 — fontSize round-trip", () => {
    it("default fontSize is 13", () => {
      const host = createXtermHost();
      expect(host.terminal.options.fontSize).toBe(13);
      host.dispose();
    });

    it("accepts a fontSize override", () => {
      const host = createXtermHost({ fontSize: 16 });
      expect(host.terminal.options.fontSize).toBe(16);
      host.dispose();
    });
  });

  describe("AC1 — theme accepted at construction", () => {
    it("accepts a derived theme and propagates to terminal.options.theme", () => {
      const theme = deriveXtermTheme({
        read: (name) =>
          ({
            "--background-primary": "#1e1e1e",
            "--text-normal": "#dcdcdc",
            "--text-accent": "#aaff00",
          })[name] ?? "",
        overrides: { solidBackground: true, useObsidianAccents: true },
      });
      const host = createXtermHost({ theme });
      const out = host.terminal.options.theme;
      expect(out?.background).toBe("#1e1e1e");
      expect(out?.foreground).toBe("#dcdcdc");
      expect(out?.cursor).toBe("#aaff00");
      host.dispose();
    });
  });

  describe("R10 — applyTheme propagates a new theme to a live terminal", () => {
    it("exposes applyTheme(theme) that updates terminal.options.theme", () => {
      const host = createXtermHost();
      const next = deriveXtermTheme({
        read: (name) =>
          name === "--background-primary" ? "#abcdef" : name === "--text-normal" ? "#fedcba" : "",
        overrides: { solidBackground: true, useObsidianAccents: true },
      });
      host.applyTheme(next);
      expect(host.terminal.options.theme?.background).toBe("#abcdef");
      expect(host.terminal.options.theme?.foreground).toBe("#fedcba");
      host.dispose();
    });
  });

  describe("R10 — applyFontFamily / applyFontSize propagate to live terminal", () => {
    it("applyFontFamily updates terminal.options.fontFamily", () => {
      const host = createXtermHost();
      host.applyFontFamily("'JetBrainsMono Nerd Font', monospace");
      expect(host.terminal.options.fontFamily).toBe(
        "'JetBrainsMono Nerd Font', monospace",
      );
      host.dispose();
    });

    it("applyFontSize updates terminal.options.fontSize", () => {
      const host = createXtermHost();
      host.applyFontSize(18);
      expect(host.terminal.options.fontSize).toBe(18);
      host.dispose();
    });
  });
});
