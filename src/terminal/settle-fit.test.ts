// BUG-003 (bug-sweep Phase 4) — unit coverage for the settle-fit scheduler.
//
// The scheduler is the pure half of the first-fit fix: after the document's
// fonts are ready AND two frames have passed (belt-and-braces for the
// one-frame layout lag between FontFace registration and metric flow), it
// invokes a corrective pass exactly once. The DOM-facing half (forced
// char-size re-measure + coalescer-bypassing fit) lives in xterm-host's
// mount() and is covered by tests/e2e/bug-003-first-fit.e2e.ts — mount()
// can't run under vitest (xterm's open() needs real layout).
//
// Deps are injected (fonts promise, frame scheduler) so these tests drive
// the ordering deterministically with no timers — testing-approach Level 1.

import { describe, it, expect } from "vitest";
import { scheduleSettleFit } from "./settle-fit";

/** Manually-pumped frame queue standing in for requestAnimationFrame. */
function createFrameQueue() {
  const queue: Array<() => void> = [];
  return {
    requestFrame: (cb: () => void) => {
      queue.push(cb);
    },
    /** Run every callback currently queued (one "frame"). */
    pump(): void {
      const batch = queue.splice(0, queue.length);
      for (const cb of batch) cb();
    },
    get pending(): number {
      return queue.length;
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks (promise continuations) run. */
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

describe("scheduleSettleFit (BUG-003)", () => {
  it("invokes onSettle exactly once: after fontsReady resolves and two frames", async () => {
    const fonts = deferred();
    const frames = createFrameQueue();
    let calls = 0;

    scheduleSettleFit({
      fontsReady: () => fonts.promise,
      requestFrame: frames.requestFrame,
      onSettle: () => {
        calls += 1;
      },
    });

    // Nothing before fonts resolve — not even a frame request.
    await flushMicrotasks();
    expect(calls).toBe(0);
    expect(frames.pending).toBe(0);

    fonts.resolve();
    await flushMicrotasks();
    // Fonts ready, but frames not pumped: still waiting.
    expect(calls).toBe(0);
    expect(frames.pending).toBe(1);

    frames.pump(); // frame 1
    expect(calls).toBe(0);
    expect(frames.pending).toBe(1);

    frames.pump(); // frame 2 — settle
    expect(calls).toBe(1);

    // No further frames requested, no second invocation possible.
    expect(frames.pending).toBe(0);
    frames.pump();
    await flushMicrotasks();
    expect(calls).toBe(1);
  });

  it("cancel before fonts resolve suppresses the settle pass", async () => {
    const fonts = deferred();
    const frames = createFrameQueue();
    let calls = 0;

    const handle = scheduleSettleFit({
      fontsReady: () => fonts.promise,
      requestFrame: frames.requestFrame,
      onSettle: () => {
        calls += 1;
      },
    });

    handle.cancel();
    fonts.resolve();
    await flushMicrotasks();
    frames.pump();
    frames.pump();
    expect(calls).toBe(0);
  });

  it("cancel between the two frames suppresses the settle pass", async () => {
    const fonts = deferred();
    const frames = createFrameQueue();
    let calls = 0;

    const handle = scheduleSettleFit({
      fontsReady: () => fonts.promise,
      requestFrame: frames.requestFrame,
      onSettle: () => {
        calls += 1;
      },
    });

    fonts.resolve();
    await flushMicrotasks();
    frames.pump(); // frame 1
    handle.cancel();
    frames.pump(); // frame 2 — must not settle
    await flushMicrotasks();
    expect(calls).toBe(0);
  });

  it("fontsReady rejection degrades silently — no settle, no unhandled rejection", async () => {
    const fonts = deferred();
    const frames = createFrameQueue();
    let calls = 0;

    scheduleSettleFit({
      fontsReady: () => fonts.promise,
      requestFrame: frames.requestFrame,
      onSettle: () => {
        calls += 1;
      },
    });

    fonts.reject(new Error("fonts API unavailable"));
    await flushMicrotasks();
    frames.pump();
    frames.pump();
    expect(calls).toBe(0);
    expect(frames.pending).toBe(0);
  });

  it("a throwing fontsReady supplier degrades silently", () => {
    const frames = createFrameQueue();
    let calls = 0;

    expect(() =>
      scheduleSettleFit({
        fontsReady: () => {
          throw new Error("document.fonts missing");
        },
        requestFrame: frames.requestFrame,
        onSettle: () => {
          calls += 1;
        },
      }),
    ).not.toThrow();
    expect(calls).toBe(0);
  });
});
