/**
 * FI-019 — coalesces redundant `fit()` calls in the xterm-host lifecycle.
 *
 * The host calls fit() once during mount() and then again from each
 * ResizeObserver fire. The first ResizeObserver fire on a freshly-mounted
 * container reports the dimensions mount() just laid out, which produced
 * a visible double-fit flicker.
 *
 * `shouldFit` returns true when this is the first call OR when the
 * dimensions differ from the most-recently-fit dimensions. The host
 * passes container dimensions; integer-equality is sufficient because
 * ResizeObserver reports the same DOMRect on settled containers.
 *
 * Pure logic, no DOM or xterm imports — unit-testable per
 * `specs/anvil/testing-approach.md` Level 1.
 */

export interface FitDimensions {
  width: number;
  height: number;
}

export interface FitCoalescer {
  shouldFit(dims: FitDimensions): boolean;
}

export function createFitCoalescer(): FitCoalescer {
  let last: FitDimensions | null = null;

  return {
    shouldFit(dims: FitDimensions): boolean {
      if (last === null) {
        last = { ...dims };
        return true;
      }
      if (dims.width !== last.width || dims.height !== last.height) {
        last = { ...dims };
        return true;
      }
      return false;
    },
  };
}
