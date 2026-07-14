// BUG-003 (bug-sweep Phase 4) — settle-fit scheduler.
//
// The very first fit after XtermHost.mount() can measure cell metrics
// before the layout engine has flowed a freshly-registered FontFace
// (registered-but-not-flowed: face.status may even be "loaded" while
// pending nodes still lay out with fallback metrics for one more frame).
// The cols/rows reported to the PTY are then off by 1-2 and full-width
// TUIs hard-wrap mid-word until a user resize forces a clean re-measure.
//
// This module schedules the corrective pass: wait for the document's
// fonts to be ready, then two frames (belt-and-braces for the one-frame
// flow lag), then invoke the callback exactly once. What the callback
// does (forced char-size re-measure + coalescer-bypassing fit) is the
// caller's business — deps are injected so this stays pure logic per
// specs/anvil/testing-approach.md Level 1, like fit-coalescer.ts.

export interface SettleFitDeps {
  /** Supplier of the fonts-ready promise (production: () => document.fonts.ready). */
  fontsReady: () => Promise<unknown>;
  /** Frame scheduler (production: requestAnimationFrame). */
  requestFrame: (cb: () => void) => void;
  /** The corrective pass to run once settled. */
  onSettle: () => void;
}

export interface SettleFitHandle {
  cancel(): void;
}

/** Schedule a one-shot settle pass: fontsReady → frame → frame → onSettle.
 *  cancel() suppresses the pass at any point before it fires. Failures in
 *  the fonts promise (or its supplier) degrade silently — the terminal
 *  keeps its mount-time fit, which is the pre-fix behavior. */
export function scheduleSettleFit(deps: SettleFitDeps): SettleFitHandle {
  let cancelled = false;

  const frame = (cb: () => void): void => {
    deps.requestFrame(() => {
      if (!cancelled) cb();
    });
  };

  try {
    deps.fontsReady().then(
      () => {
        if (cancelled) return;
        frame(() => frame(() => deps.onSettle()));
      },
      () => {
        /* fonts API failure — degrade to the mount-time fit */
      },
    );
  } catch {
    /* fontsReady supplier threw — degrade to the mount-time fit */
  }

  return {
    cancel() {
      cancelled = true;
    },
  };
}
