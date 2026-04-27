import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * AC1 + AC2 — Phase 1 grooming, FI-020 / D1 / D2.
 *
 * Pin posture is recorded in `package.json`. The PHASE'S decisions are:
 *   D1 — hold `wdio-obsidian-service` at 3.0.2 (already current upstream)
 *   D2 — hold `obsidian` at 1.12.3 (within ~1 minor of stable per CLAUDE.md)
 *
 * If a future bump is taken deliberately, update the expected versions
 * in this file alongside the bump rationale in the relevant phase
 * completion report.
 *
 * The exact-version pin (no caret/tilde) is mandatory per
 * `specs/anvil/testing-approach.md` → "Version pinning is mandatory."
 * This test fails if the pin is loosened to a range.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));

const EXPECTED_WDIO_OBSIDIAN_SERVICE = "3.0.2";
const EXPECTED_OBSIDIAN_BINARY = "1.12.3";

function isExactVersion(spec: string): boolean {
  // Reject ranges (`^`, `~`, `>=`, `*`, etc.). Accept bare semver.
  return /^\d+\.\d+\.\d+([-+].*)?$/.test(spec);
}

describe("dependency pin posture (AC1 / AC2)", () => {
  it("wdio-obsidian-service is pinned at the version recorded in D1", () => {
    const actual = pkg.devDependencies?.["wdio-obsidian-service"];
    expect(actual).toBe(EXPECTED_WDIO_OBSIDIAN_SERVICE);
  });

  it("wdio-obsidian-service pin is exact (no semver range)", () => {
    const actual = pkg.devDependencies?.["wdio-obsidian-service"];
    expect(isExactVersion(actual)).toBe(true);
  });

  it("Obsidian test binary is pinned at the version recorded in D2", () => {
    const actual = pkg.devDependencies?.obsidian;
    expect(actual).toBe(EXPECTED_OBSIDIAN_BINARY);
  });

  it("Obsidian test binary pin is exact (no semver range)", () => {
    const actual = pkg.devDependencies?.obsidian;
    expect(isExactVersion(actual)).toBe(true);
  });

  it("wdio-obsidian-reporter is pinned in lockstep with the service", () => {
    // Grouped together in dependabot.yml `wdio` group; reviewing them out
    // of sync is a footgun.
    const reporter = pkg.devDependencies?.["wdio-obsidian-reporter"];
    expect(reporter).toBe(EXPECTED_WDIO_OBSIDIAN_SERVICE);
  });
});
