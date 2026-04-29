// Phase 1 (glyph-rendering) / R5 / AC2 — visual e2e for the bundled
// Symbols Nerd Font Mono.
//
// Strategy (per spec D5): "`.notdef`-signature exclusion + non-background-
// pixel floor". For each probe codepoint we read a small region of the
// rendered terminal at the cell's centre and compare it against a baseline
// cell rendering U+F8FF (Apple-logo PUA, guaranteed outside Symbols Nerd
// Font Mono's coverage so it always paints `.notdef`). A probe is rendered
// if its signature differs from the baseline by more than a threshold AND
// the cell is not visually empty.
//
// Sampling path: `element.takeScreenshot()` (via wdio) gets a PNG of the
// WebGL canvas as the browser composited it. We decode the PNG with pngjs
// and sample the RGBA bytes. This works regardless of the WebGL addon's
// `preserveDrawingBuffer` setting — the screenshot comes from the browser
// compositor, not from `gl.readPixels` against the back buffer.
//
// (Earlier draft used `gl.readPixels` and required `preserveDrawingBuffer:
// true` on the WebglAddon. That flag caused stacked-frame trail artifacts
// in interactive use because xterm's damage-tracked partial redraws
// composited on top of the preserved buffer. We dropped the flag and
// switched the test to compositor-screenshot sampling.)
//
// RED demonstration (per R5): observed during execution by temporarily
// disabling the @font-face declaration in src/styles.css and running this
// test — the registration check fails. RED→GREEN evidence lives in the
// phase completion report, not in this file.

import { browser, expect, $ } from "@wdio/globals";
import { PNG } from "pngjs";

const PLUGIN_ID = "anvil-obsidian-terminal";
const VIEW_TYPE = "anvil-terminal-container-view";
const CANVAS_MARKER = "anvil-test-webgl-canvas";

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
// `.notdef` glyph. This is the negative signature every probe must differ
// from.
const BASELINE_CP = 0xf8ff;

// Sample window in canvas physical pixels.
const SAMPLE_W = 12;
const SAMPLE_H = 16;

// L1-distance threshold across the sample window (0..255 per channel).
const SIGNATURE_DIFF_THRESHOLD = 1500;

// Minimum count of non-background pixels in a probe sample.
const NON_BG_PIXEL_FLOOR = 5;

// A pixel counts as "non-background" if R+G+B exceeds this.
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

interface RenderInfo {
  /** WebGL canvas physical pixel width. */
  pxW: number;
  /** WebGL canvas physical pixel height. */
  pxH: number;
  /** Cell column count. */
  cols: number;
  /** Cell row count. */
  rows: number;
  /** Row index (in the visible viewport) where the probe row landed. */
  probeRowIdx: number;
  /** Canvas bounding-rect in CSS pixels relative to the viewport. */
  rect: { x: number; y: number; width: number; height: number };
  /** window.devicePixelRatio at sample time. */
  dpr: number;
  /** Whether a WebGL canvas was found and tagged. */
  found: boolean;
  /** Whether the bundled font reached `loaded` status before sampling. */
  fontLoaded: boolean;
}

/** Drive the terminal: restrict font stack, write the probe row on a fresh
 *  line, two RAFs to let xterm paint, then tag the WebGL canvas with a
 *  marker class so we can grab it from Node via a CSS selector. */
async function paintProbesAndTagCanvas(
  baselineCp: number,
  probeCps: readonly number[],
): Promise<RenderInfo> {
  return browser.executeAsync(
    function (
      baseline: number,
      probes: number[],
      viewType: string,
      marker: string,
      done: (v: RenderInfo) => void,
    ) {
      type HostLike = {
        terminal: {
          cols: number;
          rows: number;
          buffer: { active: { cursorY: number } };
          write: (data: string, cb?: () => void) => void;
        };
        applyFontFamily: (ff: string) => void;
        fit: () => void;
      };
      type ViewLike = {
        containerEl?: HTMLElement;
        getActiveHost?: () => HostLike | null;
      };
      type FaceLike = { family: string; status: string };
      const w = window as unknown as {
        app: {
          workspace: {
            getLeavesOfType: (t: string) => Array<{ view: ViewLike }>;
          };
        };
        document: {
          fonts: {
            load: (spec: string) => Promise<unknown>;
            forEach: (fn: (face: FaceLike) => void) => void;
          };
        };
        requestAnimationFrame: (cb: () => void) => number;
        devicePixelRatio: number;
      };

      const empty: RenderInfo = {
        pxW: 0,
        pxH: 0,
        cols: 0,
        rows: 0,
        probeRowIdx: 0,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        dpr: 1,
        found: false,
        fontLoaded: false,
      };

      const leaves = w.app.workspace.getLeavesOfType(viewType);
      if (!leaves.length) return done(empty);
      const view = leaves[0].view;
      const host = view.getActiveHost?.();
      if (!host) return done(empty);

      // Force-load the bundled font BEFORE we change the terminal's font
      // family. xterm's WebGL renderer measures glyphs via a Canvas 2D
      // context using the configured fontFamily; if we change family
      // before the font is loaded, the browser falls back to monospace
      // for measurement and bakes tofu glyphs into the atlas. We have to
      // wait until the FontFace status is `loaded` before triggering the
      // atlas rebuild.
      void w.document.fonts
        .load('1em "Symbols Nerd Font Mono"')
        .then(() => {
          let fontLoaded = false;
          w.document.fonts.forEach((face) => {
            if (face.family === "Symbols Nerd Font Mono" && face.status === "loaded") {
              fontLoaded = true;
            }
          });

          // Without restricting the stack, the test machine's installed
          // Nerd Fonts (e.g. MesloLGS Nerd Font Mono) would satisfy probe
          // codepoints out of the user's local system, so the test would
          // pass regardless of whether the @font-face bundle is wired.
          host.applyFontFamily("'Symbols Nerd Font Mono', monospace");
          host.fit();

          const cells = [baseline, ...probes];
          const probeText = cells
            .map((cp) => String.fromCodePoint(cp))
            .join(" ");

          host.terminal.write("\r\n", () => {
            host.terminal.write(probeText, () => {
              host.terminal.write("\r", () => {
                // applyFontFamily kicks an async atlas rebuild. Allow a
                // few frames for WebGL to paint glyphs.
                w.requestAnimationFrame(() => {
                  w.requestAnimationFrame(() => {
                    w.requestAnimationFrame(() => {
                      const xtermEl = view.containerEl?.querySelector(
                        ".xterm",
                      ) as HTMLElement | null;
                      if (!xtermEl) return done(empty);

                      const screenEl = xtermEl.querySelector(
                        ".xterm-screen",
                      ) as HTMLElement | null;
                      const screenCanvases = screenEl
                        ? (Array.from(
                            screenEl.querySelectorAll("canvas"),
                          ) as HTMLCanvasElement[])
                        : [];

                      let mainCanvas: HTMLCanvasElement | null = null;
                      for (const c of screenCanvases) {
                        if (c.getContext("webgl2") || c.getContext("webgl")) {
                          mainCanvas = c;
                          break;
                        }
                      }
                      if (!mainCanvas) return done(empty);

                      mainCanvas.classList.add(marker);

                      const r = mainCanvas.getBoundingClientRect();
                      done({
                        pxW: mainCanvas.width,
                        pxH: mainCanvas.height,
                        cols: host.terminal.cols,
                        rows: host.terminal.rows,
                        probeRowIdx: host.terminal.buffer.active.cursorY,
                        rect: {
                          x: r.x,
                          y: r.y,
                          width: r.width,
                          height: r.height,
                        },
                        dpr: w.devicePixelRatio || 1,
                        found: true,
                        fontLoaded,
                      });
                    });
                  });
                });
              });
            });
          });
        })
        .catch(() => done(empty));
    },
    baselineCp,
    [...probeCps],
    VIEW_TYPE,
    CANVAS_MARKER,
  ) as unknown as Promise<RenderInfo>;
}

interface SampleSig {
  pixels: number[];
  nonBgCount: number;
}

function samplePngCell(
  png: { width: number; height: number; data: Buffer },
  cellCenterX: number,
  cellCenterY: number,
  width: number,
  height: number,
  lumaThreshold: number,
): SampleSig {
  const x0 = Math.max(0, Math.round(cellCenterX - width / 2));
  const y0 = Math.max(0, Math.round(cellCenterY - height / 2));
  const x1 = Math.min(png.width, x0 + width);
  const y1 = Math.min(png.height, y0 + height);
  const pixels: number[] = [];
  let nonBg = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      const a = png.data[i + 3];
      pixels.push(r, g, b, a);
      if (r + g + b > lumaThreshold) nonBg += 1;
    }
  }
  return { pixels, nonBgCount: nonBg };
}

function l1Distance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum;
}

describe("nerd-font glyph visual rendering (Phase 1 / R5 / AC2)", function () {
  beforeEach(async function () {
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllTerminalLeaves();
  });

  // R3 — the bundled font is registered AND actually fetched/decoded.
  //
  // Prior tests in this file (and the project's other font tests) only
  // checked that the FontFace was *registered* — i.e. that the @font-face
  // CSS rule had been parsed by the browser. Registration alone is silent
  // about whether the font's url() is reachable. With Obsidian inlining
  // plugin CSS into a <style> tag, relative URLs in url() resolve against
  // app://obsidian.md/, NOT the plugin dir, and the woff2 fetch failed
  // with "TypeError: Failed to fetch" while the FontFace stayed in the
  // "unloaded" state. The result: the bundle was never actually painting,
  // and machines with a system Nerd Font hid the symptom.
  //
  // This test forces a load and asserts on `face.status === "loaded"`.
  // That status is the only signal that the bytes actually arrived and
  // decoded. If the URL is broken, status becomes "error" and the assert
  // fails. If registration is missing (no @font-face / FontFace.add), the
  // earlier registered-check fails first.
  it("bundled font reaches FontFace.status === 'loaded' (R3)", async function () {
    await openTerminal();
    await waitForTerminalReady();
    const fontStatus = await isBundledFontLoaded();
    expect(fontStatus.registered).toBe(true);
    expect(fontStatus.loadedStatus).toBe("loaded");
  });

  it("WebGL canvas exists under .xterm (AC1)", async function () {
    await openTerminal();
    await waitForTerminalReady();
    const info = await paintProbesAndTagCanvas(BASELINE_CP, [PROBES[0].cp]);
    expect(info.found).toBe(true);
    expect(info.pxW).toBeGreaterThan(0);
    expect(info.pxH).toBeGreaterThan(0);
  });

  it("renders bundled-font glyphs distinguishably from the .notdef baseline (AC2)", async function () {
    await openTerminal();
    await waitForTerminalReady();
    const info = await paintProbesAndTagCanvas(
      BASELINE_CP,
      PROBES.map((p) => p.cp),
    );
    expect(info.found).toBe(true);

    // Capture a PNG of the WebGL canvas via wdio. This goes through the
    // browser's compositor and works regardless of the WebGL addon's
    // preserveDrawingBuffer flag.
    expect(info.fontLoaded).toBe(true);

    // Some browser configs return the full page from element.takeScreenshot
    // rather than a cropped canvas. Take a page screenshot and crop to the
    // canvas's bounding rect (DPR-scaled) ourselves for predictability.
    const pagePngB64 = await browser.takeScreenshot();
    const pagePng = PNG.sync.read(Buffer.from(pagePngB64, "base64"));

    // The page screenshot is at physical pixel resolution (CSS px * DPR
    // observed at sample time). Use the recorded DPR rather than recomputing
    // from canvas dims since the canvas's internal width/height may differ
    // from its rendered CSS box (xterm sets canvas.width/height to drive
    // its own scaling).
    const dpr = info.dpr;
    const cropX = Math.round(info.rect.x * dpr);
    const cropY = Math.round(info.rect.y * dpr);
    const cropW = Math.round(info.rect.width * dpr);
    const cropH = Math.round(info.rect.height * dpr);

    // Save full-page + crop region for debugging when assertions fail.
    await import("node:fs").then((fs) => {
      const dir = "tests/e2e/.diagnostic";
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        `${dir}/visual-e2e-page.png`,
        Buffer.from(pagePngB64, "base64"),
      );
    });

    // Cell metrics within the cropped region.
    const cellW = cropW / info.cols;
    const cellH = cropH / info.rows;

    const sampleColumn = (col: number): SampleSig => {
      const cellCenterX = cropX + (col + 0.5) * cellW;
      const cellCenterY = cropY + (info.probeRowIdx + 0.5) * cellH;
      return samplePngCell(
        pagePng,
        cellCenterX,
        cellCenterY,
        SAMPLE_W,
        SAMPLE_H,
        NON_BG_LUMA_THRESHOLD,
      );
    };

    // Layout: cell 0 = baseline, then space, then probe 0, space, ...
    const baseline = sampleColumn(0);
    const probeSamples = PROBES.map((_, i) => sampleColumn(2 + 2 * i));

    const failures: string[] = [];
    for (let i = 0; i < PROBES.length; i += 1) {
      const probe = PROBES[i];
      const sample = probeSamples[i];
      const dist = l1Distance(sample.pixels, baseline.pixels);
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
          `baseline.nonBgCount=${baseline.nonBgCount}`,
          `pageSize=${pagePng.width}x${pagePng.height} crop=(${cropX},${cropY},${cropW}x${cropH}) cells=${info.cols}x${info.rows} probeRow=${info.probeRowIdx}`,
        ].join("\n"),
      );
    }
  });
});
