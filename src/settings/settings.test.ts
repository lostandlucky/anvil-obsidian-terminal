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
});
