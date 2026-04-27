import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

/**
 * AC3 — Phase 1 grooming, FI-020.
 *
 * `.github/dependabot.yml` must:
 *   - parse cleanly as YAML
 *   - declare `version: 2`
 *   - contain a `cargo` ecosystem entry pointing at `/pty-server`
 *   - mirror the npm entry's conventions (label `dependencies`, weekly
 *     cadence, group pattern so updates land for review as a set)
 *
 * D3 resolution names this exactly. Test enforces it.
 */

interface DependabotUpdate {
  "package-ecosystem": string;
  directory: string;
  schedule?: { interval?: string; day?: string };
  labels?: string[];
  groups?: Record<string, { patterns?: string[] }>;
  "open-pull-requests-limit"?: number;
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdate[];
}

const REPO_ROOT = join(__dirname, "..", "..");
const CONFIG_PATH = join(REPO_ROOT, ".github", "dependabot.yml");

function loadConfig(): DependabotConfig {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return yaml.load(raw) as DependabotConfig;
}

describe("dependabot config (AC3)", () => {
  it("parses as valid YAML", () => {
    expect(() => loadConfig()).not.toThrow();
  });

  it("declares version 2", () => {
    const cfg = loadConfig();
    expect(cfg.version).toBe(2);
  });

  it("has an updates array", () => {
    const cfg = loadConfig();
    expect(Array.isArray(cfg.updates)).toBe(true);
    expect(cfg.updates.length).toBeGreaterThan(0);
  });

  it("retains the existing npm entry (regression pin)", () => {
    const cfg = loadConfig();
    const npm = cfg.updates.find((u) => u["package-ecosystem"] === "npm");
    expect(npm, "npm entry must still be present").toBeDefined();
    expect(npm?.directory).toBe("/");
  });

  it("contains a cargo ecosystem entry", () => {
    const cfg = loadConfig();
    const cargo = cfg.updates.find((u) => u["package-ecosystem"] === "cargo");
    expect(cargo, "cargo ecosystem entry missing — D3 unresolved").toBeDefined();
  });

  it("the cargo entry targets /pty-server", () => {
    const cfg = loadConfig();
    const cargo = cfg.updates.find((u) => u["package-ecosystem"] === "cargo");
    expect(cargo?.directory).toBe("/pty-server");
  });

  it("the cargo entry uses weekly cadence (mirrors npm convention)", () => {
    const cfg = loadConfig();
    const cargo = cfg.updates.find((u) => u["package-ecosystem"] === "cargo");
    expect(cargo?.schedule?.interval).toBe("weekly");
  });

  it("the cargo entry carries the `dependencies` label (mirrors npm convention)", () => {
    const cfg = loadConfig();
    const cargo = cfg.updates.find((u) => u["package-ecosystem"] === "cargo");
    expect(cargo?.labels).toContain("dependencies");
  });

  it("the cargo entry groups updates so review happens as a set (mirrors wdio group pattern)", () => {
    const cfg = loadConfig();
    const cargo = cfg.updates.find((u) => u["package-ecosystem"] === "cargo");
    expect(cargo?.groups, "cargo entry must define a group").toBeDefined();
    const groupNames = Object.keys(cargo?.groups ?? {});
    expect(groupNames.length).toBeGreaterThan(0);
  });
});
