// AC5 — Settings tab control specs.
//
// Approach: Setting() / ToggleComponent / DropdownComponent are runtime
// classes from obsidian.js (the actual app), not the @types/obsidian package.
// Unit tests can't construct them. We test the control-spec layer instead:
// buildSettingsControlSpecs() returns a list of typed descriptors that the
// thin display() shell maps to Obsidian's Setting API. Spec-list shape is
// the contract. The actual rendering is verified manually + by the user
// testing checklist (and is otherwise a thin transform).

import { describe, it, expect } from "vitest";
import { buildSettingsControlSpecs } from "./settings-controls";
import { DEFAULT_SETTINGS } from "./settings";

function snapshotHost() {
  let settings = { ...DEFAULT_SETTINGS };
  const patches: Array<Partial<typeof settings>> = [];
  return {
    host: {
      app: {} as never,
      getSettings: () => settings,
      updateSettings: async (patch: Partial<typeof settings>) => {
        patches.push(patch);
        // Support shallow nested patch for themeOverrides without a full
        // normalize call — the test only inspects what the spec emitted.
        settings = { ...settings, ...patch };
      },
    },
    patches,
  };
}

describe("buildSettingsControlSpecs (AC5)", () => {
  it("includes the existing three controls (default shell, additional shells, preserve tmux)", () => {
    const { host } = snapshotHost();
    const specs = buildSettingsControlSpecs(host);
    const names = specs.map((s) => s.name);
    expect(names.some((n) => /default shell/i.test(n))).toBe(true);
    expect(names.some((n) => /additional shells/i.test(n))).toBe(true);
    expect(names.some((n) => /preserve tmux/i.test(n))).toBe(true);
  });

  it("includes the five new Phase 2 controls", () => {
    const { host } = snapshotHost();
    const specs = buildSettingsControlSpecs(host);
    const names = specs.map((s) => s.name);
    expect(names.some((n) => /font family/i.test(n))).toBe(true);
    expect(names.some((n) => /font size/i.test(n))).toBe(true);
    expect(names.some((n) => /tmux session name format/i.test(n))).toBe(true);
    expect(names.some((n) => /solid background/i.test(n))).toBe(true);
    expect(names.some((n) => /use obsidian accents/i.test(n))).toBe(true);
  });

  describe("font family control", () => {
    it("is a text spec; getValue returns current setting", () => {
      const { host } = snapshotHost();
      const specs = buildSettingsControlSpecs(host);
      const spec = specs.find((s) => /font family/i.test(s.name))!;
      expect(spec.kind).toBe("text");
      expect(spec.kind === "text" && spec.getValue()).toBe(
        DEFAULT_SETTINGS.fontFamily,
      );
    });

    it("setValue routes through host.updateSettings", async () => {
      const { host, patches } = snapshotHost();
      const specs = buildSettingsControlSpecs(host);
      const spec = specs.find((s) => /font family/i.test(s.name))!;
      if (spec.kind !== "text") throw new Error("expected text");
      await spec.setValue("'MesloLGS NF', monospace");
      expect(patches.some((p) => p.fontFamily === "'MesloLGS NF', monospace"))
        .toBe(true);
    });
  });

  describe("font size control", () => {
    it("is a number spec; setValue parses the string and patches a number", async () => {
      const { host, patches } = snapshotHost();
      const specs = buildSettingsControlSpecs(host);
      const spec = specs.find((s) => /font size/i.test(s.name))!;
      if (spec.kind !== "text") throw new Error("expected text (numeric input)");
      await spec.setValue("16");
      expect(patches.some((p) => p.fontSize === 16)).toBe(true);
    });

    it("setValue with a non-numeric string is rejected (no fontSize patch emitted)", async () => {
      const { host, patches } = snapshotHost();
      const specs = buildSettingsControlSpecs(host);
      const spec = specs.find((s) => /font size/i.test(s.name))!;
      if (spec.kind !== "text") throw new Error("expected text");
      await spec.setValue("nope");
      expect(patches.some((p) => p.fontSize !== undefined)).toBe(false);
    });
  });

  describe("tmux session name format control", () => {
    it("is a dropdown spec with both options", () => {
      const { host } = snapshotHost();
      const specs = buildSettingsControlSpecs(host);
      const spec = specs.find((s) =>
        /tmux session name format/i.test(s.name),
      )!;
      expect(spec.kind).toBe("dropdown");
      if (spec.kind !== "dropdown") throw new Error("expected dropdown");
      expect(Object.keys(spec.options)).toContain("integer");
      expect(Object.keys(spec.options)).toContain("obsidian-prefix");
    });

    it("setValue patches tmuxSessionNameFormat", async () => {
      const { host, patches } = snapshotHost();
      const specs = buildSettingsControlSpecs(host);
      const spec = specs.find((s) =>
        /tmux session name format/i.test(s.name),
      )!;
      if (spec.kind !== "dropdown") throw new Error("expected dropdown");
      await spec.setValue("obsidian-prefix");
      expect(
        patches.some((p) => p.tmuxSessionNameFormat === "obsidian-prefix"),
      ).toBe(true);
    });
  });

  describe("solid background toggle", () => {
    it("is a toggle spec; getValue mirrors themeOverrides.solidBackground", () => {
      const { host } = snapshotHost();
      const specs = buildSettingsControlSpecs(host);
      const spec = specs.find((s) => /solid background/i.test(s.name))!;
      expect(spec.kind).toBe("toggle");
      if (spec.kind !== "toggle") throw new Error("expected toggle");
      expect(spec.getValue()).toBe(false);
    });

    it("setValue patches themeOverrides.solidBackground while preserving useObsidianAccents", async () => {
      const { host, patches } = snapshotHost();
      const specs = buildSettingsControlSpecs(host);
      const spec = specs.find((s) => /solid background/i.test(s.name))!;
      if (spec.kind !== "toggle") throw new Error("expected toggle");
      await spec.setValue(true);
      const patch = patches.find(
        (p) => p.themeOverrides?.solidBackground === true,
      );
      expect(patch).toBeTruthy();
      expect(patch!.themeOverrides!.useObsidianAccents).toBe(true);
    });
  });

  describe("use obsidian accents toggle", () => {
    it("setValue patches themeOverrides.useObsidianAccents while preserving solidBackground", async () => {
      const { host, patches } = snapshotHost();
      const specs = buildSettingsControlSpecs(host);
      const spec = specs.find((s) => /use obsidian accents/i.test(s.name))!;
      if (spec.kind !== "toggle") throw new Error("expected toggle");
      await spec.setValue(false);
      const patch = patches.find(
        (p) => p.themeOverrides?.useObsidianAccents === false,
      );
      expect(patch).toBeTruthy();
      expect(patch!.themeOverrides!.solidBackground).toBe(false);
    });
  });
});
