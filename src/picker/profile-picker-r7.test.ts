import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * AC9 / R7 — graceful-degrade source assertion.
 *
 * The profile picker overrides SuggestModal.updateSuggestions, an
 * undocumented Obsidian internal. Per R7, the override MUST follow the
 * feature-detect + try/catch pattern used across the plugin for
 * undocumented APIs (see src/dock/wrap-and-dock.ts:canWrap + guarded
 * invocations, or src/view/TerminalContainerView.ts's leaf.setDimension
 * fallback).
 *
 * Runtime test of the throw path is awkward (the obsidian module isn't
 * resolvable from browser.execute in the e2e harness, and Obsidian doesn't
 * expose modal instances on the DOM). The structural source guarantee +
 * the entire happy-path e2e suite passing is the proof:
 *   - Every other picker e2e test exercises the override on the happy path.
 *     If injection threw uncaught, those tests would fail.
 *   - The source guarantee proves the catch is in place to swallow the
 *     unhappy path.
 */
describe("profile-picker R7 graceful degrade", () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, "profile-picker.ts"),
    "utf-8",
  );

  it("section-label injection is wrapped in try/catch", () => {
    // Match: try { <anything> this.injectSectionLabels() <anything> } catch
    const pattern = /try\s*\{[\s\S]*?this\.injectSectionLabels\(\)[\s\S]*?\}\s*catch/;
    expect(pattern.test(SRC)).toBe(true);
  });

  it("super.updateSuggestions call is wrapped in try/catch", () => {
    const pattern = /try\s*\{[\s\S]*?updateSuggestions[\s\S]*?\}\s*catch/;
    expect(pattern.test(SRC)).toBe(true);
  });

  it("feature-detects updateSuggestions on SuggestModal.prototype", () => {
    // The const flag pattern from the implementation.
    const pattern = /SuggestModal\.prototype[\s\S]*?updateSuggestions/;
    expect(pattern.test(SRC)).toBe(true);
  });

  it("does not contain a 'case \"header\"' branch (D2/R5/AC7)", () => {
    expect(/case\s+["']header["']/.test(SRC)).toBe(false);
  });
});
