import { describe, it, expect } from "vitest";
import { createFitCoalescer } from "./fit-coalescer";

/**
 * AC5 — Phase 1 grooming, FI-019.
 *
 * The xterm-host previously called `fit.fit()` once during `mount()` and
 * again from the first ResizeObserver fire on the same initial container
 * observation. The double-fit was visible as a cell-count flicker.
 *
 * This module pulls the "should we fit?" decision out of xterm-host so it
 * can be unit-tested without a real DOM. Behavior the host wires it to:
 *   1. mount() — call fit.fit() unconditionally; record dimensions.
 *   2. ResizeObserver fire — call fit.fit() only if dimensions changed
 *      since the last fit.
 *
 * The redundant initial-observation fire is therefore skipped because
 * dimensions match what mount() just recorded.
 */

describe("fit-coalescer", () => {
  it("first fit is always allowed (mount)", () => {
    const coalescer = createFitCoalescer();
    expect(coalescer.shouldFit({ width: 800, height: 600 })).toBe(true);
  });

  it("skips a follow-up fit when dimensions are unchanged (the double-fit case)", () => {
    const coalescer = createFitCoalescer();
    coalescer.shouldFit({ width: 800, height: 600 });
    expect(coalescer.shouldFit({ width: 800, height: 600 })).toBe(false);
  });

  it("allows a fit when width changes", () => {
    const coalescer = createFitCoalescer();
    coalescer.shouldFit({ width: 800, height: 600 });
    expect(coalescer.shouldFit({ width: 1024, height: 600 })).toBe(true);
  });

  it("allows a fit when height changes", () => {
    const coalescer = createFitCoalescer();
    coalescer.shouldFit({ width: 800, height: 600 });
    expect(coalescer.shouldFit({ width: 800, height: 480 })).toBe(true);
  });

  it("counts fit() exactly once across mount + N stable-size resize fires", () => {
    // The integration shape this pins: a real lifecycle calls shouldFit()
    // once at mount and then again from each ResizeObserver fire. With
    // stable dimensions, only the mount call should resolve to a real fit.
    const coalescer = createFitCoalescer();
    let fitCount = 0;
    const dims = { width: 800, height: 600 };

    // mount
    if (coalescer.shouldFit(dims)) fitCount += 1;

    // 5 ResizeObserver fires on a stable container
    for (let i = 0; i < 5; i++) {
      if (coalescer.shouldFit(dims)) fitCount += 1;
    }

    expect(fitCount).toBe(1);
  });

  it("regression pin for FI-019 double-fit: mount + immediate observer fire = 1 fit", () => {
    // The exact pre-change failure mode: mount() fits once, then the
    // ResizeObserver's initial-observation callback fires synchronously
    // with the same dimensions and would have caused a second fit.
    const coalescer = createFitCoalescer();
    const dims = { width: 1200, height: 800 };

    const mountFit = coalescer.shouldFit(dims);
    const observerFit = coalescer.shouldFit(dims);

    expect(mountFit).toBe(true);
    expect(observerFit).toBe(false);
  });

  it("after a real resize, a follow-up stable fire is suppressed again", () => {
    const coalescer = createFitCoalescer();
    coalescer.shouldFit({ width: 800, height: 600 }); // mount
    coalescer.shouldFit({ width: 800, height: 600 }); // observer init — skipped
    expect(coalescer.shouldFit({ width: 1024, height: 768 })).toBe(true); // real resize
    expect(coalescer.shouldFit({ width: 1024, height: 768 })).toBe(false); // settle
  });
});
