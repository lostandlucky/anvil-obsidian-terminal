import { browser, expect, $ } from "@wdio/globals";

/**
 * Phase 3 / FI-018 hygiene scenarios automated in WebdriverIO.
 *
 * AC1 — plugin reload mid-session: disable + re-enable, shell PID dies,
 *       a new terminal opens cleanly afterwards.
 * AC2 — multi-terminal abnormal exit: open two terminals, kill one's
 *       shell from the keyboard side via `exit`, the other keeps working.
 * AC3 — close-while-active: open a terminal, run a continuous-output
 *       command, close the tab, the shell PID is dead within 1 second.
 *
 * Manual-only scenarios (Obsidian force-quit, OS-level kill of pty-server,
 * hung shell unresponsive to SIGTERM, Obsidian crash recovery) live in
 * specs/anvil/manual-test-checklist.md under "Phase 3 — process hygiene".
 */

const PLUGIN_ID = "anvil-obsidian-terminal";
const VIEW_TYPE = "anvil-terminal-container-view";

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type ObsidianWindow = Window & {
  app: {
    plugins: {
      plugins: Record<string, unknown>;
      enabledPlugins: Set<string>;
      disablePlugin: (id: string) => Promise<void>;
      enablePlugin: (id: string) => Promise<void>;
    };
    workspace: {
      getLeavesOfType: (type: string) => Array<{
        view: unknown;
        detach(): void;
      }>;
      detachLeavesOfType: (type: string) => void;
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

async function focusTerminal() {
  await $(".anvil-terminal-container-view .xterm-helper-textarea").waitForExist({
    timeout: 5000,
  });
  await browser.execute(() => {
    const ta = document.querySelector(
      ".anvil-terminal-container-view .xterm-helper-textarea",
    ) as HTMLTextAreaElement | null;
    ta?.focus();
  });
}

// Renderer-agnostic — reads the active xterm buffer instead of `.xterm-rows`.
// Required after Phase 1 (glyph-rendering) switched the plugin to the
// WebGL renderer; the DOM-row container stays empty under WebGL.
async function readTerminalText(): Promise<string> {
  return browser.execute((viewType: string) => {
    type ViewLike = {
      getActiveHost?: () => {
        terminal: {
          buffer: {
            active: {
              length: number;
              getLine: (
                r: number,
              ) => { translateToString: (trim?: boolean) => string } | undefined;
            };
          };
        };
      } | null;
    };
    type Ws = {
      app: {
        workspace: {
          getLeavesOfType: (t: string) => Array<{ view: ViewLike }>;
        };
      };
    };
    const app = (window as unknown as Ws).app;
    const leaves = app.workspace.getLeavesOfType(viewType);
    if (!leaves.length) return "";
    const host = leaves[0].view.getActiveHost?.();
    if (!host) return "";
    const buf = host.terminal.buffer.active;
    const out: string[] = [];
    for (let r = 0; r < buf.length; r += 1) {
      const ln = buf.getLine(r);
      if (ln) out.push(ln.translateToString(true));
    }
    return out.join("\n");
  }, VIEW_TYPE);
}

async function waitForShellReady() {
  await browser.waitUntil(
    async () => (await readTerminalText()).trim().length > 0,
    { timeout: 10000, timeoutMsg: "shell never produced output" },
  );
  await browser.pause(300);
}

async function getActiveBackendPid(tabIdx = 0): Promise<number | null> {
  return browser.execute((viewType: string, idx: number) => {
    const app = (window as unknown as ObsidianWindow).app;
    const leaves = app.workspace.getLeavesOfType(viewType);
    const view = leaves[0]?.view as {
      getTabIds?: () => string[];
      getActiveBackend?: () => { childPid?: () => number | null } | null;
    };
    if (!view) return null;
    // The view exposes only an "active backend" handle. We assume the test
    // switches to the desired tab before calling. For the multi-tab case
    // the caller can use the per-tab variant below.
    void idx;
    return view.getActiveBackend?.()?.childPid?.() ?? null;
  }, VIEW_TYPE, tabIdx);
}

async function pidAlive(pid: number): Promise<boolean> {
  return browser.execute((p: number) => {
    try {
      const cp = require("child_process");
      return cp.spawnSync("kill", ["-0", String(p)]).status === 0;
    } catch {
      return false;
    }
  }, pid);
}

describe("phase-3 hygiene (FI-018)", function () {
  beforeEach(async function () {
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllTerminalLeaves();
  });

  // AC1 — plugin reload mid-session.
  it("AC1: disable + re-enable kills the shell and a new terminal still opens", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    const pid = await getActiveBackendPid();
    expect(pid).toBeGreaterThan(0);

    // Disable the plugin while the shell is running.
    await browser.execute(async (id: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      await app.plugins.disablePlugin(id);
    }, PLUGIN_ID);
    await browser.pause(500);

    // Shell PID is gone.
    expect(await pidAlive(pid as number)).toBe(false);

    // Re-enable.
    await browser.execute(async (id: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      await app.plugins.enablePlugin(id);
    }, PLUGIN_ID);
    await browser.pause(500);

    // Plugin reloaded — opening a new terminal should succeed.
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    const newPid = await getActiveBackendPid();
    expect(newPid).toBeGreaterThan(0);
    expect(newPid).not.toBe(pid);
  });

  // AC2 — multi-terminal abnormal exit.
  it("AC2: one shell exits, sibling continues to function", async function () {
    // Open the first terminal.
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    // Open a second tab via the container view's addTab. The plugin's
    // public surface is openDefaultTerminal which routes through the
    // container; calling it again adds a sibling tab inside the same
    // container view, which is the multi-terminal model.
    await browser.executeAsync((id: string, done: (v: unknown) => void) => {
      const app = (window as unknown as ObsidianWindow).app;
      const plugin = app.plugins.plugins[id] as AnvilPluginLike;
      void plugin.openDefaultTerminal().then(() => done(null));
    }, PLUGIN_ID);

    await browser.waitUntil(
      async () =>
        await browser.execute((viewType: string) => {
          const app = (window as unknown as ObsidianWindow).app;
          const leaves = app.workspace.getLeavesOfType(viewType);
          const view = leaves[0]?.view as { getTabIds?: () => string[] };
          return (view?.getTabIds?.().length ?? 0) >= 2;
        }, VIEW_TYPE),
      { timeout: 10000, timeoutMsg: "second tab never appeared" },
    );

    // Drive an `exit 1` keystrokes-equivalent through the active backend
    // for the currently-active tab (the newly-opened second one).
    await browser.execute((viewType: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(viewType);
      const view = leaves[0]?.view as {
        getActiveBackend?: () => { write: (s: string) => void } | null;
      };
      view?.getActiveBackend?.()?.write("exit 1\n");
    }, VIEW_TYPE);
    await browser.pause(800);

    // Switch back to the first tab and verify it still works.
    await browser.execute((viewType: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(viewType);
      const view = leaves[0]?.view as {
        getTabIds?: () => string[];
        switchTab?: (id: string) => void;
      };
      const ids = view?.getTabIds?.() ?? [];
      if (ids.length > 0 && view?.switchTab) view.switchTab(ids[0]);
    }, VIEW_TYPE);
    await browser.pause(300);

    // Send a marker through the (still-alive) first tab's backend.
    await browser.execute((viewType: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(viewType);
      const view = leaves[0]?.view as {
        getActiveBackend?: () => { write: (s: string) => void } | null;
      };
      view?.getActiveBackend?.()?.write('printf "STILL_ALIVE=%s\\n" yes\n');
    }, VIEW_TYPE);

    await browser.waitUntil(
      async () => /STILL_ALIVE=yes/.test(await readTerminalText()),
      { timeout: 10000, timeoutMsg: "first tab did not respond after sibling exited" },
    );
  });

  // AC3 — close-while-active.
  it("AC3: closing a tab during heavy output kills its shell within 1s", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    // Capture the PID before we start emitting heavy output.
    const pid = await getActiveBackendPid();
    expect(pid).toBeGreaterThan(0);

    // Drive a continuous-output command. `yes` is the canonical infinite
    // stream and stresses the WebSocket → xterm pipeline. Use the backend
    // write directly for determinism (browser.keys for a 4-char command
    // is reliable but risk-free to bypass).
    await browser.execute((viewType: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(viewType);
      const view = leaves[0]?.view as {
        getActiveBackend?: () => { write: (s: string) => void } | null;
      };
      view?.getActiveBackend?.()?.write("yes\n");
    }, VIEW_TYPE);
    await browser.pause(500);

    // Close all terminal leaves while output is streaming.
    await closeAllTerminalLeaves();

    // Within 1 second, the shell PID must be dead. Poll up to 1s; the
    // assertion is "dead by 1s," not "dead immediately."
    const start = Date.now();
    let alive = true;
    while (Date.now() - start < 1000 && alive) {
      alive = await pidAlive(pid as number);
      if (!alive) break;
      await browser.pause(50);
    }
    expect(alive).toBe(false);
  });
});
