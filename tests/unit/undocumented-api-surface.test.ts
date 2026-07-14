import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * AC4 — Phase 1 grooming, FI-020 + R5.
 *
 * Four undocumented Obsidian APIs are used in production:
 *   1. `rootSplit.setDirection`        — src/main.ts, src/dock/wrap-and-dock.ts
 *   2. `workspace.createLeafInParent`  — src/main.ts
 *   3. `SuggestModal.chooser.setSelectedItem` — src/picker/profile-picker.ts
 *   4. `workspace.createLeafBySplit`   — src/dock/wrap-and-dock.ts (R5, ADR-0007)
 *
 * Re-verification at the test level: each API is referenced in production
 * code, and each call site uses a feature-detect (`typeof === "function"`)
 * or optional-chaining guard so missing APIs degrade gracefully rather
 * than crash. Drift detection at runtime (does the API still EXIST against
 * the pinned binary) is covered by the existing e2e suite which exercises
 * every dock-open / picker-open path against a real Obsidian. This test
 * pins the *static surface* — that we still call them, and that we still
 * guard them. Removing the guards or the call sites accidentally is the
 * regression this test catches.
 */

const REPO_ROOT = join(__dirname, "..", "..");

function readSrc(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf-8");
}

describe("undocumented Obsidian API surface (AC4 / R4 / R5)", () => {
  it("rootSplit.setDirection is referenced + guarded in main.ts", () => {
    const src = readSrc("src/main.ts");
    expect(src).toMatch(/setDirection/);
    expect(src).toMatch(/typeof\s+rootSplit\.setDirection\s*===\s*["']function["']/);
  });

  it("rootSplit.setDirection is referenced + guarded in wrap-and-dock.ts", () => {
    const src = readSrc("src/dock/wrap-and-dock.ts");
    expect(src).toMatch(/setDirection/);
    // canWrap() includes a typeof check on rootSplit.setDirection
    expect(src).toMatch(/typeof\s+rootSplit\.setDirection\s*===\s*["']function["']/);
  });

  it("workspace.createLeafInParent is referenced + guarded in main.ts", () => {
    const src = readSrc("src/main.ts");
    expect(src).toMatch(/createLeafInParent/);
    expect(src).toMatch(/typeof\s+workspace\.createLeafInParent\s*===\s*["']function["']/);
  });

  it("SuggestModal.chooser.setSelectedItem is referenced + optional-chained in profile-picker.ts", () => {
    const src = readSrc("src/picker/profile-picker.ts");
    expect(src).toMatch(/setSelectedItem/);
    // optional-chaining or explicit feature-detect; either form is acceptable
    expect(src).toMatch(/setSelectedItem\?\.|typeof[^;]*setSelectedItem/);
  });

  it("workspace.createLeafBySplit is referenced + guarded in wrap-and-dock.ts (R5)", () => {
    const src = readSrc("src/dock/wrap-and-dock.ts");
    expect(src).toMatch(/createLeafBySplit/);
    expect(src).toMatch(
      /typeof\s+workspace\.createLeafBySplit\s*===\s*["']function["']/,
    );
  });

  it("ADR-0007 reference is preserved in wrap-and-dock.ts", () => {
    // R5 calls out the source's ADR linkage. A refactor that drops the
    // pointer is fine; a refactor that drops the guard is not. We assert
    // the canWrap() function exists by name as the central guard.
    const src = readSrc("src/dock/wrap-and-dock.ts");
    expect(src).toMatch(/export function canWrap/);
  });
});

describe("undocumented xterm API surface (BUG-003)", () => {
  // Same convention as the Obsidian surface above, different vendor:
  // the BUG-003 corrective settle-fit must force a char-size re-measure
  // through xterm's private _core._charSizeService (fit() alone reads the
  // render service's cached cell dims and no-ops at unchanged container
  // size). The seam is feature-detected so an xterm upgrade that moves it
  // degrades to the pre-fix behavior instead of crashing. Runtime coverage
  // (does the seam still WORK against the pinned xterm) is carried by
  // tests/e2e/bug-003-first-fit.e2e.ts; this pins the static surface —
  // that we still call it, and that we still guard it.
  it("_core._charSizeService.measure is referenced + feature-detected in xterm-host.ts", () => {
    const src = readSrc("src/terminal/xterm-host.ts");
    expect(src).toMatch(/_charSizeService/);
    expect(src).toMatch(
      /typeof\s+core\?\._charSizeService\?\.measure\s*===\s*["']function["']/,
    );
  });
});
