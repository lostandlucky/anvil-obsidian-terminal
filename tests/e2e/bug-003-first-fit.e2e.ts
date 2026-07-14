// BUG-003 (bug-sweep Phase 4) — first-fit cell measurement.
//
// The very first terminal open in a fresh vault fits against cell metrics
// measured BEFORE the layout engine has flowed a freshly-registered
// FontFace, so the cols/rows reported to the PTY are off by 1-2 and
// full-width TUIs (claude's welcome card) hard-wrap mid-word until a user
// resize forces a clean re-measure.
//
// The anchor here reproduces that mechanism deterministically, amplified:
// a probe FontFace whose bytes arrive over a deliberately slow local HTTP
// server is placed FIRST in the terminal's font stack (ahead of Georgia,
// whose metrics differ hugely). The terminal mounts while the probe load
// is in flight — the mount-time fit measures Georgia fallback metrics,
// exactly the registered-but-not-flowed state of the production bug. Once
// the probe font lands and fonts.ready resolves, the first-reported cols
// must equal a settled post-font-flow fit.
//
// The settled reference is obtained through the same seam the fix uses:
// a forced char-size re-measure (xterm's fit()/proposeDimensions read the
// render service's CACHED cell dims, so at unchanged container size a bare
// corrective fit recomputes the same stale cols and silently no-ops).
//
// The steady-state pin guards the flip side: when fonts are already
// settled (bundled font registered at plugin onload — or absent entirely,
// same no-op path), the corrective pass must produce ZERO resize events
// and stable cols. xterm itself carries this: measure() fires no event
// when metrics are unchanged and fit() only resizes when cols/rows differ.

import { browser, expect, $ } from "@wdio/globals";
import * as http from "node:http";
import * as fs from "node:fs";
import type { AddressInfo } from "node:net";

const PLUGIN_ID = "anvil-obsidian-terminal";
const CONTAINER_VIEW_TYPE = "anvil-terminal-container-view";
const PROBE_FAMILY = "AnvilBug003Probe";
// Monaco: ASCII coverage, cell metrics far from Georgia's — the stale vs
// settled cols differ by tens of columns, so the assertion can't sit on
// a floor()-boundary knife edge.
const PROBE_FONT_PATH = "/System/Library/Fonts/Monaco.ttf";
// Long enough that the terminal reliably mounts while the load is still
// in flight (mount is typically well under a second after open).
const PROBE_FONT_DELAY_MS = 1500;
// Comfortably covers the corrective pass (fonts.ready + two frames).
const SETTLE_WINDOW_MS = 500;

interface AnvilPluginLike {
  openDefaultTerminal: () => Promise<void>;
  getSettings: () => { fontFamily: string };
  updateSettings: (patch: { fontFamily?: string }) => Promise<void>;
}

interface HostLike {
  terminal: { cols: number; rows: number };
  fit: () => void;
  onResize: (handler: (size: { cols: number; rows: number }) => void) => void;
}

interface ContainerViewLike {
  getActiveHost?: () => HostLike | null;
}

interface FontFaceLike {
  status: string;
  load: () => Promise<unknown>;
}

interface Bug003State {
  face?: FontFaceLike;
  steadyCount?: number;
  steadyColsAtAttach?: number;
}

interface Ws extends Window {
  app: {
    plugins: { plugins: Record<string, AnvilPluginLike> };
    workspace: {
      getLeavesOfType: (t: string) => Array<{ view: ContainerViewLike }>;
      detachLeavesOfType: (t: string) => void;
      trigger?: (n: string) => void;
    };
  };
  __anvilBug003?: Bug003State;
}

async function closeAllContainers(): Promise<void> {
  await browser.execute((t: string) => {
    const app = (window as unknown as Ws).app;
    app.workspace.detachLeavesOfType(t);
    app.workspace.trigger?.("layout-change");
  }, CONTAINER_VIEW_TYPE);
}

async function openTerminal(): Promise<void> {
  await browser.executeAsync((id: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    void app.plugins.plugins[id].openDefaultTerminal().then(() => done(null));
  }, PLUGIN_ID);
  await $(".anvil-terminal-container-view .xterm").waitForExist({ timeout: 10000 });
}

describe("BUG-003 — first-fit cell measurement", function () {
  let server: http.Server | null = null;
  let fontUrl = "";
  let origFontFamily: string | null = null;

  before(async function () {
    const bytes = fs.readFileSync(PROBE_FONT_PATH);
    server = http.createServer((req, res) => {
      // FontFace url() loads are CORS-checked against the app:// origin.
      res.writeHead(200, {
        "Content-Type": "font/ttf",
        "Content-Length": bytes.byteLength,
        "Access-Control-Allow-Origin": "*",
      });
      setTimeout(() => res.end(bytes), PROBE_FONT_DELAY_MS);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    fontUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/probe.ttf`;
  });

  after(async function () {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  afterEach(async function () {
    await browser.execute((id: string, orig: string | null) => {
      const w = window as unknown as Ws;
      const state = w.__anvilBug003;
      if (state?.face) {
        try {
          (document as unknown as { fonts: { delete: (f: unknown) => void } }).fonts.delete(
            state.face,
          );
        } catch {
          /* already gone */
        }
      }
      delete w.__anvilBug003;
      if (orig !== null) {
        void w.app.plugins.plugins[id].updateSettings({ fontFamily: orig });
      }
    }, PLUGIN_ID, origFontFamily);
    origFontFamily = null;
    await closeAllContainers();
  });

  it("steady-state pin — settled fonts produce zero resize events and stable cols", async function () {
    // Bundled font registered (and flowed) at plugin onload, long before
    // this mount: the corrective settle pass must be a zero-event no-op.
    await openTerminal();
    await browser.execute((t: string) => {
      const w = window as unknown as Ws;
      const view = w.app.workspace.getLeavesOfType(t)[0]?.view;
      const host = view?.getActiveHost?.();
      if (!host) throw new Error("no active host after open");
      w.__anvilBug003 = { steadyCount: 0, steadyColsAtAttach: host.terminal.cols };
      host.onResize(() => {
        const s = (window as unknown as Ws).__anvilBug003;
        if (s) s.steadyCount = (s.steadyCount ?? 0) + 1;
      });
    }, CONTAINER_VIEW_TYPE);

    await browser.pause(SETTLE_WINDOW_MS + 200);

    const steady = await browser.execute((t: string) => {
      const w = window as unknown as Ws;
      const host = w.app.workspace.getLeavesOfType(t)[0]?.view?.getActiveHost?.();
      const s = w.__anvilBug003;
      return {
        count: s?.steadyCount ?? -1,
        colsAtAttach: s?.steadyColsAtAttach ?? -1,
        colsNow: host?.terminal.cols ?? -1,
      };
    }, CONTAINER_VIEW_TYPE);

    expect(steady.colsAtAttach).toBeGreaterThan(2);
    expect(steady.colsNow).toBe(steady.colsAtAttach);
    expect(steady.count).toBe(0);
  });

  it("anchor — first-reported cols equal a settled post-font-flow fit", async function () {
    // 1. Register the probe face and start its (slow) load, then put it
    //    first in the terminal font stack. Status must be "loading" —
    //    in flight, not yet usable: the production registered-but-not-
    //    flowed state, amplified.
    const statusAtStart = await browser.execute(
      (url: string, family: string) => {
        const w = window as unknown as Ws;
        const face = new FontFace(family, `url(${url})`) as unknown as FontFaceLike;
        (document as unknown as { fonts: { add: (f: unknown) => void } }).fonts.add(face);
        void face.load();
        w.__anvilBug003 = { face };
        return face.status;
      },
      fontUrl,
      PROBE_FAMILY,
    );
    expect(statusAtStart).toBe("loading");

    origFontFamily = await browser.execute(
      async (id: string, family: string) => {
        const plugin = (window as unknown as Ws).app.plugins.plugins[id];
        const orig = plugin.getSettings().fontFamily;
        await plugin.updateSettings({ fontFamily: `'${family}', Georgia` });
        return orig;
      },
      PLUGIN_ID,
      PROBE_FAMILY,
    );

    // 2. Mount while the probe load is in flight.
    await openTerminal();
    const statusAtMount = await browser.execute(
      () => (window as unknown as Ws).__anvilBug003?.face?.status ?? "missing",
    );
    // Precondition, not the assertion under test: if the probe finished
    // loading before the terminal mounted, the repro didn't create the
    // stale-metrics state and this test proves nothing — fail loudly.
    expect(statusAtMount).toBe("loading");

    // 3. Let the font land and the document settle.
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => (window as unknown as Ws).__anvilBug003?.face?.status ?? "missing",
        )) === "loaded",
      { timeout: 10000, timeoutMsg: "probe font never finished loading" },
    );
    await browser.executeAsync((done: (v: unknown) => void) => {
      void (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready.then(() =>
        done(null),
      );
    });
    await browser.pause(SETTLE_WINDOW_MS);

    // 4. First-reported cols must already equal a settled fit. The settled
    //    reference forces a char-size re-measure through the same seam the
    //    fix uses — a bare fit() would read the cached (stale) cell dims
    //    and reproduce the wrong cols.
    const result = await browser.execute((t: string) => {
      const w = window as unknown as Ws;
      const host = w.app.workspace.getLeavesOfType(t)[0]?.view?.getActiveHost?.();
      if (!host) throw new Error("no active host after open");
      const reported = host.terminal.cols;
      const core = (
        host.terminal as unknown as {
          _core?: { _charSizeService?: { measure?: () => void } };
        }
      )._core;
      if (typeof core?._charSizeService?.measure !== "function") {
        throw new Error("xterm _charSizeService.measure seam missing — settled reference unavailable");
      }
      core._charSizeService.measure();
      host.fit();
      const settled = host.terminal.cols;
      return { reported, settled };
    }, CONTAINER_VIEW_TYPE);

    expect(result.settled).toBeGreaterThan(2);
    // THE BUG-003 assertion: what the PTY was told must match the
    // post-font-flow measurement, with no user resize in between.
    expect(result.reported).toBe(result.settled);
  });
});
