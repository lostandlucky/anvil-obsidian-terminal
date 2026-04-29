// Phase 1 (glyph-rendering) / R5 / AC2 — visual e2e for the bundled
// Symbols Nerd Font Mono.
//
// Strategy (per spec D5): "`.notdef`-signature exclusion + non-background-
// pixel floor". For each probe codepoint we read a small region of the
// WebGL canvas at the cell's centre and compare it against a baseline cell
// rendering U+F8FF (Apple-logo PUA, guaranteed outside Symbols Nerd Font
// Mono's coverage so it always paints `.notdef`). A probe is considered
// rendered if its signature differs from the baseline by more than a
// threshold AND the cell is not visually empty.
//
// Both samples come from the same canvas / DPR / compositor pass, which
// eliminates platform-render variance. macOS-only project scope removes
// the cross-platform-pixel-test argument.
//
// RED demonstration (per R5): observed during execution by temporarily
// disabling the @font-face declaration in src/styles.css and running this
// test — it must fail. The RED→GREEN evidence lives in the phase
// completion report, not in this file.

import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const VIEW_TYPE = "anvil-terminal-container-view";

// One probe per major nerd-font block. Codepoints chosen to fall inside
// Symbols Nerd Font Mono v3.x's coverage per the canonical block list in
// the @font-face unicode-range.
const PROBES = [
  { name: "Powerline right-arrow", cp: 0xe0b0 },
  { name: "Devicons github", cp: 0xe709 },
  { name: "Octicons mark-github", cp: 0xf408 },
  { name: "Font Awesome home", cp: 0xf015 },
  { name: "Codicons account", cp: 0xea60 },
  { name: "Material Design (SMP) account", cp: 0xf0004 },
] as const;

// `.notdef` baseline. U+F8FF (Apple logo PUA) is outside the canonical
// Symbols Nerd Font Mono coverage, so it always renders the font's
// `.notdef` glyph (typically an empty rectangle). This is the negative
// signature every probe must differ from.
const BASELINE_CP = 0xf8ff;

// Sample window in canvas physical pixels. Centered on the cell. Small
// enough to avoid inter-cell antialiasing bleed; large enough to capture
// glyph strokes.
const SAMPLE_W = 12;
const SAMPLE_H = 16;

// Pixel-difference threshold (L1 distance, 0..255 per channel). Empirical
// floor — well above per-frame WebGL noise, well below typical glyph deltas.
const SIGNATURE_DIFF_THRESHOLD = 1500;

// Minimum count of non-background pixels in a probe sample. Floor catches
// "cell renders nothing" (font failed to load, codepoint outside coverage,
// renderer crashed silently). Background = pixels close to opaque-black.
const NON_BG_PIXEL_FLOOR = 5;

// A pixel counts as "non-background" if its R+G+B sum exceeds this. Since
// the test theme's terminal background is transparent-on-black and glyphs
// are light, glyph strokes register strongly here while empty cells stay
// near zero.
const NON_BG_LUMA_THRESHOLD = 60;

interface AnvilPluginLike {
  openDefaultTerminal: () => Promise<void>;
}

interface ObsidianWindow extends Window {
  app: {
    plugins: { plugins: Record<string, unknown> };
    workspace: {
      detachLeavesOfType: (t: string) => void;
      getLeavesOfType: (t: string) => Array<{ view: unknown }>;
    };
  };
}

async function closeAllTerminalLeaves() {
  await browser.execute((type: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    app.workspace.detachLeavesOfType(type);
  }, VIEW_TYPE);
}

async function openTerminal() {
  await browser.executeAsync((id: string, done: (v: unknown) => void) => {
    const app = (window as unknown as ObsidianWindow).app;
    const plugin = app.plugins.plugins[id] as AnvilPluginLike;
    void plugin.openDefaultTerminal().then(() => done(null));
  }, PLUGIN_ID);
  await $(".anvil-terminal-container-view .xterm").waitForExist({ timeout: 10000 });
}

async function waitForTerminalReady() {
  await browser.waitUntil(
    async () => {
      return browser.execute((viewType: string) => {
        type ViewLike = { getActiveHost?: () => unknown };
        const app = (window as unknown as ObsidianWindow).app;
        const leaves = app.workspace.getLeavesOfType(viewType);
        if (!leaves.length) return false;
        const view = leaves[0].view as ViewLike;
        return typeof view.getActiveHost === "function" && !!view.getActiveHost();
      }, VIEW_TYPE);
    },
    { timeout: 10_000, timeoutMsg: "active xterm host never reachable" },
  );
}

interface ProbeSample {
  /** Probe-cell pixel buffer, raw RGBA. */
  pixels: number[];
  nonBgCount: number;
}

interface VisualResult {
  hasCanvas: boolean;
  canvasCount: number;
  rendererFlavor: "webgl" | "canvas2d" | "dom";
  baseline: ProbeSample;
  probes: ProbeSample[];
}

/** Drive the terminal, render baseline + probes on a known row, then read
 *  pixels off the WebGL canvas. All work happens inside the page so the
 *  same DPR / compositor pass produces both samples. */
async function captureProbes(
  baselineCp: number,
  probeCps: readonly number[],
  sampleW: number,
  sampleH: number,
  lumaThreshold: number,
): Promise<VisualResult | null> {
  return browser.executeAsync(
    function (
      baseline: number,
      probes: number[],
      width: number,
      height: number,
      luma: number,
      viewType: string,
      done: (v: VisualResult | null) => void,
    ) {
      type HostLike = {
        terminal: {
          cols: number;
          rows: number;
          buffer: { active: { cursorY: number } };
          write: (data: string, cb?: () => void) => void;
          element?: HTMLElement;
        };
        applyFontFamily: (ff: string) => void;
        fit: () => void;
      };
      type ViewLike = {
        containerEl?: HTMLElement;
        getActiveHost?: () => HostLike | null;
      };

      const w = window as unknown as {
        app: {
          workspace: {
            getLeavesOfType: (t: string) => Array<{ view: ViewLike }>;
          };
        };
        requestAnimationFrame: (cb: () => void) => number;
        devicePixelRatio: number;
      };

      const leaves = w.app.workspace.getLeavesOfType(viewType);
      if (!leaves.length) return done(null);
      const view = leaves[0].view;
      const host = view.getActiveHost?.();
      if (!host) return done(null);

      // Constrain the font stack to ONLY the bundled family + monospace.
      // Without this, the test machine's installed Nerd Fonts (e.g.
      // MesloLGS Nerd Font Mono) would satisfy probe codepoints out of the
      // user's local system, and the test would pass regardless of whether
      // the @font-face bundle is wired up. Forcing the stack to depend on
      // the bundle is what makes R5's RED-demonstration meaningful: with
      // the @font-face commented out, every probe should fall through to
      // monospace and miss.
      host.applyFontFamily("'Symbols Nerd Font Mono', monospace");
      host.fit();

      // Compose the probe row. Layout: <baseline> <probe1> <probe2> ...
      // Each glyph is followed by a space so adjacent cells don't bleed.
      // CR+LF first to land on a fresh line so we know which row got it.
      const cells = [baseline, ...probes];
      const probeText = cells.map((cp) => String.fromCodePoint(cp)).join(" ");

      // Move to a fresh line, write probes, then a trailing CR so the
      // cursor leaves the probe row alone for measurement.
      host.terminal.write("\r\n", () => {
        host.terminal.write(probeText, () => {
          host.terminal.write("\r", () => {
            // Three RAFs: applyFontFamily kicks an async atlas rebuild;
            // a single frame is not always enough for WebGL to paint
            // glyphs into the freshly-rebuilt atlas before sampling.
            w.requestAnimationFrame(() => {
              w.requestAnimationFrame(() => {
              w.requestAnimationFrame(() => {
                const xtermEl =
                  view.containerEl?.querySelector(".xterm") as HTMLElement | null;
                if (!xtermEl) return done(null);

                // The WebGL renderer mounts its render canvas inside
                // `.xterm-screen`. xterm.js's WebGL addon also appends
                // texture-atlas canvases to the document (often larger than
                // the visible canvas), which broke an earlier
                // largest-canvas heuristic by picking the atlas. Anchor to
                // .xterm-screen so we only consider rendering canvases.
                const screenEl = xtermEl.querySelector(
                  ".xterm-screen",
                ) as HTMLElement | null;
                const allCanvases = Array.from(
                  xtermEl.querySelectorAll("canvas"),
                ) as HTMLCanvasElement[];
                const screenCanvases = screenEl
                  ? (Array.from(
                      screenEl.querySelectorAll("canvas"),
                    ) as HTMLCanvasElement[])
                  : [];

                // Pick the WebGL-context canvas under .xterm-screen.
                // Multiple canvases may live there (cursor / link layers,
                // depending on xterm version) — only one will report a
                // WebGL context.
                let mainCanvas: HTMLCanvasElement | null = null;
                let rendererFlavor: "webgl" | "canvas2d" | "dom" = "dom";
                for (const c of screenCanvases) {
                  const gl2 = c.getContext("webgl2");
                  if (gl2) {
                    mainCanvas = c;
                    rendererFlavor = "webgl";
                    break;
                  }
                  const gl1 = c.getContext("webgl");
                  if (gl1) {
                    mainCanvas = c;
                    rendererFlavor = "webgl";
                    break;
                  }
                }
                // Fallback: if nothing under .xterm-screen carries WebGL,
                // record what's there for diagnostics. Pick the largest
                // visible 2D canvas if any.
                if (!mainCanvas) {
                  let bestArea = -1;
                  for (const c of screenCanvases) {
                    const area = c.clientWidth * c.clientHeight;
                    if (area > bestArea) {
                      bestArea = area;
                      mainCanvas = c;
                    }
                  }
                  if (mainCanvas) {
                    const ctx2 = mainCanvas.getContext("2d");
                    if (ctx2) rendererFlavor = "canvas2d";
                  }
                }

                const hasCanvas = mainCanvas !== null;

                const empty: ProbeSample = { pixels: [], nonBgCount: 0 };
                const result: VisualResult = {
                  hasCanvas,
                  canvasCount: allCanvases.length,
                  rendererFlavor,
                  baseline: empty,
                  probes: probes.map(() => empty),
                };

                if (!mainCanvas || rendererFlavor !== "webgl") {
                  return done(result);
                }

                // Cell metrics from the canvas's CSS box. WebGL canvas
                // spans the renderable grid; cellW / cellH are in CSS px.
                const cellWcss = mainCanvas.clientWidth / host.terminal.cols;
                const cellHcss = mainCanvas.clientHeight / host.terminal.rows;
                const dpr = w.devicePixelRatio || 1;

                const gl =
                  (mainCanvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
                  (mainCanvas.getContext("webgl") as WebGLRenderingContext | null);
                if (!gl) return done(result);

                // Probe row = the row the cursor was on before we wrote
                // the trailing CR. xterm advances the cursor down on `\n`
                // (the first \r\n), so the probe row is one above current
                // cursorY when no auto-scroll happened. To keep the calc
                // robust against auto-scroll, walk the active buffer for
                // the row containing our baseline char.
                // Simpler and good enough: probe row index = cursorY when
                // we wrote the row, before \r. Cursor is now on probe row.
                const probeRowIdx = host.terminal.buffer.active.cursorY;

                const sampleAt = (col: number): ProbeSample => {
                  // Center of cell in CSS coords.
                  const xCssCenter = (col + 0.5) * cellWcss;
                  const yCssCenter = (probeRowIdx + 0.5) * cellHcss;
                  const xPx = Math.round(xCssCenter * dpr - width / 2);
                  const yCssPx = Math.round(yCssCenter * dpr - height / 2);
                  // WebGL y=0 is the BOTTOM of the canvas; flip.
                  const yPx = mainCanvas!.height - yCssPx - height;
                  const buf = new Uint8Array(width * height * 4);
                  gl.readPixels(
                    xPx,
                    yPx,
                    width,
                    height,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    buf,
                  );
                  let nonBg = 0;
                  for (let i = 0; i < buf.length; i += 4) {
                    const r = buf[i];
                    const g = buf[i + 1];
                    const b = buf[i + 2];
                    if (r + g + b > luma) nonBg += 1;
                  }
                  // Convert to plain array so it can cross the wdio
                  // bridge — Uint8Array doesn't serialize.
                  const pixels: number[] = new Array(buf.length);
                  for (let i = 0; i < buf.length; i += 1) pixels[i] = buf[i];
                  return { pixels, nonBgCount: nonBg };
                };

                // Layout: cell 0 is baseline, then ' ', then probe 0, ' ',
                // probe 1, ... So probe k sits at column 2 + 2*k; baseline
                // at column 0.
                result.baseline = sampleAt(0);
                for (let k = 0; k < probes.length; k += 1) {
                  result.probes[k] = sampleAt(2 + 2 * k);
                }
                done(result);
              });
              });
            });
          });
        });
      });
    },
    baselineCp,
    [...probeCps],
    sampleW,
    sampleH,
    lumaThreshold,
    VIEW_TYPE,
  );
}

function l1Distance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum;
}

async function isBundledFontLoaded(): Promise<{
  registered: boolean;
  loadedStatus: string | null;
}> {
  return browser.executeAsync(function (done: (v: unknown) => void) {
    type FaceLike = { family: string; status: string };
    type W = {
      document: {
        fonts: {
          load: (fontSpec: string) => Promise<unknown>;
          forEach: (fn: (face: FaceLike) => void) => void;
        };
      };
    };
    const w = window as unknown as W;
    void w.document.fonts
      .load('1em "Symbols Nerd Font Mono"')
      .then(() => {
        let registered = false;
        let loadedStatus: string | null = null;
        w.document.fonts.forEach((face) => {
          if (face.family === "Symbols Nerd Font Mono") {
            registered = true;
            loadedStatus = face.status;
          }
        });
        done({ registered, loadedStatus });
      })
      .catch(() => done({ registered: false, loadedStatus: null }));
  }) as unknown as Promise<{ registered: boolean; loadedStatus: string | null }>;
}

describe("nerd-font glyph visual rendering (Phase 1 / R5 / AC2)", function () {
  beforeEach(async function () {
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllTerminalLeaves();
  });

  it("@font-face for Symbols Nerd Font Mono is registered (R3)", async function () {
    // Open a terminal so the plugin's styles.css is linked into the
    // document and the @font-face block is parsed. Registration is the
    // boolean signal that the bundle is wired up — actual fetch / load
    // status is browser-driven (font-display: block, lazy fetch on first
    // codepoint hit). Removing the @font-face declaration drops
    // registration to false, which is the RED state R5 cares about.
    await openTerminal();
    await waitForTerminalReady();
    const fontStatus = await isBundledFontLoaded();
    expect(fontStatus.registered).toBe(true);
  });

  it("WebGL canvas exists under .xterm (AC1)", async function () {
    await openTerminal();
    await waitForTerminalReady();
    const result = await captureProbes(
      BASELINE_CP,
      [PROBES[0].cp],
      SAMPLE_W,
      SAMPLE_H,
      NON_BG_LUMA_THRESHOLD,
    );
    if (!result) throw new Error("active host unreachable");
    expect(result.hasCanvas).toBe(true);
    expect(result.canvasCount).toBeGreaterThan(0);
    expect(result.rendererFlavor).toBe("webgl");
  });

  it("renders bundled-font glyphs distinguishably from the .notdef baseline (AC2)", async function () {
    await openTerminal();
    await waitForTerminalReady();
    const result = await captureProbes(
      BASELINE_CP,
      PROBES.map((p) => p.cp),
      SAMPLE_W,
      SAMPLE_H,
      NON_BG_LUMA_THRESHOLD,
    );
    if (!result) throw new Error("active host unreachable");

    // Sanity: WebGL is what's drawing.
    expect(result.rendererFlavor).toBe("webgl");

    const failures: string[] = [];
    for (let i = 0; i < PROBES.length; i += 1) {
      const probe = PROBES[i];
      const sample = result.probes[i];
      const dist = l1Distance(sample.pixels, result.baseline.pixels);
      const ok =
        sample.nonBgCount >= NON_BG_PIXEL_FLOOR &&
        dist >= SIGNATURE_DIFF_THRESHOLD;
      if (!ok) {
        failures.push(
          `${probe.name} (U+${probe.cp.toString(16).toUpperCase()}) ` +
            `nonBgCount=${sample.nonBgCount} (floor=${NON_BG_PIXEL_FLOOR}), ` +
            `signatureDist=${dist} (threshold=${SIGNATURE_DIFF_THRESHOLD})`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        [
          "Probe codepoints failed to render distinguishably from the .notdef baseline:",
          ...failures.map((f) => `  - ${f}`),
          "",
          `baseline.nonBgCount=${result.baseline.nonBgCount}`,
          `renderer=${result.rendererFlavor} canvases=${result.canvasCount}`,
        ].join("\n"),
      );
    }
  });
});
