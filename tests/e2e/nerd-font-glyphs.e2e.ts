// Data-path test for FI-021 / FI-022: write a curated set of nerd-font
// codepoints directly into xterm via `host.terminal.write()` and assert
// they land in the active buffer at the right cells with the right widths.
//
// We bypass the PTY/shell deliberately. The xterm side is the surface
// where the bug lives — does xterm's UTF-8 decoder + buffer storage +
// renderer choice handle these codepoints correctly. Going through the
// shell adds wrap-on-typed-command and printf-escape-interpretation
// noise that obscures the actual question.
//
// What this test DOES verify:
//   - xterm's decoder preserves codepoint values across `write()`
//   - The active buffer stores the right characters at the right cells
//   - Cell width is 1 per codepoint (no double-cell allocation)
//   - The plugin's configured fontFamily is on the terminal at runtime
//
// What this test does NOT verify:
//   - Visual glyph fidelity. The xterm renderer (canvas or DOM) may paint
//     tofu for codepoints the resolved font has no glyph for; that's a
//     font-coverage problem, not a data-path problem. This test catches
//     the data path.

import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const VIEW_TYPE = "anvil-terminal-container-view";

// Curated nerd-font codepoint sample. Add more here when a specific tofu
// surfaces during dogfooding.
const NERD_FONT_PROBES = [
  { name: "Powerline right-arrow", cp: 0xe0b0 },
  { name: "Powerline branch", cp: 0xe0a0 },
  { name: "Devicons npm", cp: 0xe71e },
  { name: "Devicons github", cp: 0xe709 },
  { name: "Octicons git-branch", cp: 0xf418 },
  { name: "Octicons mark-github", cp: 0xf408 },
  { name: "FontAwesome home", cp: 0xf015 },
  { name: "FontAwesome folder", cp: 0xf07b },
  { name: "FontAwesome warning", cp: 0xf071 },
  { name: "Codicons account", cp: 0xea60 },
  { name: "Codicons folder", cp: 0xea83 },
  { name: "Codicons terminal", cp: 0xea85 },
  { name: "Pomicons skull", cp: 0xe002 },
  { name: "Weather sun", cp: 0xe30d },
] as const;

const ASCII_BASELINE = "X";
const OPEN = "::OPEN::";
const CLOSE = "::CLOSE::";

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type ObsidianWindow = Window & {
  app: {
    plugins: { plugins: Record<string, unknown> };
    workspace: {
      detachLeavesOfType: (type: string) => void;
      getLeavesOfType: (type: string) => Array<{ view: unknown }>;
    };
  };
};

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

interface BufferProbe {
  outputRow: string;
  cells: { col: number; cp: number; width: number }[];
  fontFamily: string;
  rendererFlavor: "canvas" | "dom";
  bufferRowCount: number;
}

// Write a probe line directly into xterm via host.terminal.write(), then
// read the resulting buffer state. Returns null if the active host or its
// terminal can't be reached.
async function writeProbeAndRead(
  probeString: string,
): Promise<BufferProbe | null> {
  return browser.execute((line: string, viewType: string, openMarker: string) => {
    type ViewLike = {
      getActiveHost?: () => {
        terminal: {
          write: (data: string, cb?: () => void) => void;
          buffer: {
            active: {
              length: number;
              getLine: (row: number) => {
                translateToString: (trimRight?: boolean) => string;
                getCell: (col: number) => {
                  getChars: () => string;
                  getWidth: () => number;
                } | undefined;
                length: number;
              } | undefined;
            };
          };
          options: { fontFamily?: string };
        };
      };
    };
    const app = (window as unknown as ObsidianWindow).app;
    const leaves = app.workspace.getLeavesOfType(viewType);
    if (!leaves.length) return null;
    const view = leaves[0].view as ViewLike;
    const host = view.getActiveHost?.();
    if (!host) return null;

    // Cursor to a known column so we can read the row predictably. Write a
    // CR+LF first to get to a fresh line, then the probe string.
    host.terminal.write("\r\n");
    // Sync via the optional callback would be ideal but we don't await it;
    // a small delay below is enough for xterm's decoder to settle.
    host.terminal.write(line);

    // Drain: write a no-op marker and synchronously read after. xterm.write
    // is async-ish; spin a few times to let the buffer settle.
    return new Promise<BufferProbe | null>((resolve) => {
      host.terminal.write("\r\n", () => {
        const buf = host.terminal.buffer.active;
        const wrapper = leaves[0].view as { containerEl?: HTMLElement } & ViewLike;
        // Find the row containing OPEN; that's where we wrote.
        let outputRow = "";
        let outputRowIdx = -1;
        for (let r = 0; r < buf.length; r++) {
          const ln = buf.getLine(r);
          if (!ln) continue;
          const text = ln.translateToString(true);
          if (text.includes(openMarker)) {
            outputRow = text;
            outputRowIdx = r;
            break;
          }
        }
        const cells: { col: number; cp: number; width: number }[] = [];
        if (outputRowIdx >= 0) {
          const ln = buf.getLine(outputRowIdx);
          if (ln) {
            for (let col = 0; col < ln.length; col++) {
              const cell = ln.getCell(col);
              if (!cell) continue;
              const ch = cell.getChars();
              if (!ch) continue;
              const cp = ch.codePointAt(0);
              if (cp === undefined) continue;
              cells.push({ col, cp, width: cell.getWidth() });
            }
          }
        }
        const containerEl = wrapper.containerEl;
        const xtermEl = containerEl?.querySelector(".xterm");
        const rendererFlavor: "canvas" | "dom" = xtermEl?.querySelector("canvas")
          ? "canvas"
          : "dom";
        resolve({
          outputRow,
          cells,
          fontFamily: host.terminal.options.fontFamily ?? "",
          rendererFlavor,
          bufferRowCount: buf.length,
        });
      });
    });
  }, probeString, VIEW_TYPE, OPEN);
}

function probeString(): string {
  const chars = NERD_FONT_PROBES.map((p) => String.fromCodePoint(p.cp)).join(" ");
  return `${OPEN} ${ASCII_BASELINE} ${chars} ${CLOSE}`;
}

async function waitForTerminalReady() {
  // Wait for the host to be reachable and its terminal to be mounted.
  await browser.waitUntil(
    async () => {
      return browser.execute((viewType: string) => {
        type ViewLike = {
          getActiveHost?: () => unknown;
        };
        const app = (window as unknown as ObsidianWindow).app;
        const leaves = app.workspace.getLeavesOfType(viewType);
        if (!leaves.length) return false;
        const view = leaves[0].view as ViewLike;
        return typeof view.getActiveHost === "function" && !!view.getActiveHost();
      }, VIEW_TYPE);
    },
    { timeout: 10000, timeoutMsg: "active xterm host never reachable" },
  );
}

describe("nerd-font glyph data path (FI-021/FI-022)", function () {
  beforeEach(async function () {
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllTerminalLeaves();
  });

  it("xterm preserves every probe codepoint when written directly", async function () {
    await openTerminal();
    await waitForTerminalReady();
    const probe = await writeProbeAndRead(probeString());
    if (!probe) throw new Error("active host unreachable");

    // Sanity on the output row's structure.
    expect(probe.outputRow).toContain(OPEN);
    expect(probe.outputRow).toContain(CLOSE);
    expect(probe.outputRow).toContain(` ${ASCII_BASELINE} `);

    // Each probe codepoint should appear as its actual character somewhere
    // in the output row. Failure here = data-path bug.
    const missing: string[] = [];
    for (const probeCp of NERD_FONT_PROBES) {
      const expectedChar = String.fromCodePoint(probeCp.cp);
      if (!probe.outputRow.includes(expectedChar)) {
        missing.push(
          `${probeCp.name} (U+${probeCp.cp.toString(16).toUpperCase()})`,
        );
      }
    }
    if (missing.length > 0) {
      throw new Error(
        [
          "Probe codepoints missing from xterm buffer:",
          ...missing.map((m) => `  - ${m}`),
          "",
          `outputRow: ${JSON.stringify(probe.outputRow)}`,
          `renderer: ${probe.rendererFlavor}`,
          `fontFamily: ${probe.fontFamily}`,
        ].join("\n"),
      );
    }
  });

  it("each probe codepoint occupies exactly one cell (width=1)", async function () {
    await openTerminal();
    await waitForTerminalReady();
    const probe = await writeProbeAndRead(probeString());
    if (!probe) throw new Error("active host unreachable");
    if (probe.cells.length === 0) {
      throw new Error(
        `xterm buffer cells unreadable in this run; renderer=${probe.rendererFlavor} bufferRowCount=${probe.bufferRowCount}`,
      );
    }
    const wide: string[] = [];
    for (const probeCp of NERD_FONT_PROBES) {
      const cell = probe.cells.find((c) => c.cp === probeCp.cp);
      if (!cell) continue; // Already covered by the previous test's failure.
      if (cell.width !== 1) {
        wide.push(
          `${probeCp.name} (U+${probeCp.cp.toString(16).toUpperCase()}) at col ${cell.col} has width ${cell.width}`,
        );
      }
    }
    if (wide.length > 0) {
      throw new Error(
        [
          "Probe codepoints stored with non-1 cell width (will tofu-render in production):",
          ...wide.map((w) => `  - ${w}`),
        ].join("\n"),
      );
    }
  });

  it("xterm runtime fontFamily includes a nerd-font name and no var()", async function () {
    await openTerminal();
    await waitForTerminalReady();
    const probe = await writeProbeAndRead(probeString());
    if (!probe) throw new Error("active host unreachable");

    expect(probe.fontFamily).toMatch(/Nerd Font|MesloLGS NF/);
    expect(probe.fontFamily).not.toContain("var(");
  });
});
