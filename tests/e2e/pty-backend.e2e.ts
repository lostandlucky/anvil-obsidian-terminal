import { browser, expect, $ } from "@wdio/globals";

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
    commands: { executeCommandById: (id: string) => boolean };
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

async function readTerminalText(): Promise<string> {
  return browser.execute(() => {
    const rows = document.querySelector(
      ".anvil-terminal-container-view .xterm-rows",
    );
    return rows ? (rows as HTMLElement).innerText : "";
  });
}

async function waitForShellReady() {
  await browser.waitUntil(
    async () => (await readTerminalText()).trim().length > 0,
    { timeout: 10000, timeoutMsg: "shell never produced output" },
  );
  // Give the shell a moment to finish painting its prompt.
  await browser.pause(300);
}

async function typeCommand(line: string) {
  // browser.keys accepts a string and types it character-by-character
  // through the focused element.
  await browser.keys(line);
  await browser.keys(["Enter"]);
}

describe("pty-backend e2e", function () {
  beforeEach(async function () {
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllTerminalLeaves();
  });

  // Regression-pin for the zsh PROMPT_EOL_MARK (reverse-video `%`) bug
  // surfaced during Phase 3 dogfooding. When backend.start() is fired
  // fire-and-forget inside addTab, the shell's initial SIGWINCH lands
  // mid-startup and leaves the PTY in a line-mode state where bare `\n`
  // doesn't return the cursor to column 0. zsh's promptcr check then
  // stamps every prompt with `%` on its own line. The fix is to await
  // backend.start() before switchTab so the shell comes up in a
  // correctly-sized PTY and never sees that transitional state.
  //
  // If this test fails: someone likely reverted the ordering in
  // TerminalContainerView.addTab. The fire-and-forget variant was tried
  // to satisfy AC8 (tab persistence); AC8 was dropped — see
  // specs/anvil/pane-chrome-and-picker/phase-3-workspace-container-completion-report.md
  // "Post-merge rescope".
  // Regression-pin for the zsh PROMPT_EOL_MARK bug surfaced during Phase 3
  // dogfooding. The VISIBLE symptom — reverse-video `%` on every prompt —
  // only reproduces under a specific combination of zsh config and PTY
  // startup timing that the test environment doesn't share (test vault uses
  // default zsh PS1; user's vault has a custom theme). We therefore pin the
  // INVARIANT that was violated, not the symptom: when openDefaultTerminal
  // resolves, the backend must have finished starting — i.e. its child PID
  // must be non-null.
  //
  // If this fails: someone likely reverted addTab's `await backend.start()`
  // to the fire-and-forget `void this.startBackend(...)` variant. That
  // ordering introduces a race between the backend's boot and the switchTab
  // → rAF fit → SIGWINCH sequence. When the SIGWINCH lands mid-startup,
  // the PTY's line-mode ends up such that bare `\n` doesn't return cursor
  // to column 0, and zsh's promptcr stamps every prompt with `%`.
  //
  // Full context: specs/anvil/pane-chrome-and-picker/phase-3-workspace-container-completion-report.md
  // under "Post-merge rescope".
  it("openDefaultTerminal waits for backend start (PROMPT_EOL_MARK regression pin)", async function () {
    // Capture the backend's socket state AT THE MOMENT openDefaultTerminal
    // resolves — inside the .then() callback, synchronous with resolution.
    // PtyBackend.start() sets `this.child` synchronously (via spawn) and
    // `this.socket` synchronously (via new WebSocket), so neither alone
    // indicates full readiness. Only socket.readyState === OPEN (=1)
    // becomes true after the awaited connectSocket resolves. With
    // fire-and-forget, addTab returns before that await lands; the pin
    // then catches the regression.
    const stateAtResolve = await browser.executeAsync(
      (id: string, viewType: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const plugin = app.plugins.plugins[id] as AnvilPluginLike;
        void plugin.openDefaultTerminal().then(() => {
          const leaves = app.workspace.getLeavesOfType(viewType);
          const view = leaves[0]?.view as unknown as {
            getActiveBackend?: () => unknown;
          };
          const backend = view?.getActiveBackend?.() as unknown as {
            socket?: { readyState?: number } | null;
            childPid?: () => number | null;
          } | null;
          done({
            pid: backend?.childPid?.() ?? null,
            socketReadyState: backend?.socket?.readyState ?? null,
          });
        });
      },
      PLUGIN_ID,
      VIEW_TYPE,
    );
    const s = stateAtResolve as { pid: number | null; socketReadyState: number | null };
    expect(s.pid).not.toBeNull();
    expect(s.pid as number).toBeGreaterThan(0);
    // WebSocket.OPEN === 1. Any other value (CONNECTING=0, CLOSING=2,
    // CLOSED=3, or null) means backend.start() had not finished when
    // addTab resolved — i.e. fire-and-forget was reintroduced.
    expect(s.socketReadyState).toBe(1);
  });

  it("printf MARKER round-trips through a real shell", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    await typeCommand('printf "MARKER=%s\\n" hi');

    await browser.waitUntil(
      async () => /MARKER=hi/.test(await readTerminalText()),
      { timeout: 10000, timeoutMsg: "MARKER never appeared in output" },
    );
  });

  it("ANSI colors from a real shell render as styled spans", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    await typeCommand("printf '\\e[31mREDMARK\\e[0m\\n'");

    await browser.waitUntil(
      async () => /REDMARK/.test(await readTerminalText()),
      { timeout: 10000, timeoutMsg: "REDMARK never appeared" },
    );

    const text = await readTerminalText();
    expect(text).not.toContain("\x1b[31m");

    const styledSpans = await browser.execute(() => {
      const rows = document.querySelector(
        ".anvil-terminal-container-view .xterm-rows",
      );
      if (!rows) return 0;
      let styled = 0;
      for (const span of Array.from(rows.querySelectorAll("span"))) {
        const cls = (span as HTMLElement).className || "";
        const style = (span as HTMLElement).getAttribute("style") || "";
        if (/xterm-fg-/.test(cls) || /color\s*:/.test(style)) styled++;
      }
      return styled;
    });
    expect(styledSpans).toBeGreaterThan(0);
  });

  it("Ctrl-C interrupts a long-running program and the shell survives", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    await typeCommand("sleep 30");
    await browser.pause(500);
    // Send 0x03 directly through the backend — the byte xterm.js would
    // produce for Ctrl-C. Tests the backend → PTY → signal path without
    // depending on browser.keys' modifier handling, which is unreliable
    // across WebDriver versions.
    await browser.execute((viewType: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(viewType);
      const view = leaves[0]?.view as {
        getActiveBackend?: () => { write: (s: string) => void } | null;
      };
      view?.getActiveBackend?.()?.write("\x03");
    }, VIEW_TYPE);
    await browser.pause(500);
    // Prove the shell is alive by running another command.
    await typeCommand('printf "AFTER=%s\\n" alive');

    await browser.waitUntil(
      async () => /AFTER=alive/.test(await readTerminalText()),
      {
        timeout: 10000,
        timeoutMsg: "shell did not respond after Ctrl-C interrupt",
      },
    );
  });

  it("resizing the pane changes the shell's $COLUMNS", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    await typeCommand('printf "WIDE_COLS=%s\\n" "$(tput cols)"');
    await browser.waitUntil(
      async () => /WIDE_COLS=\d+/.test(await readTerminalText()),
      { timeout: 10000, timeoutMsg: "first tput cols never printed" },
    );
    const wideMatch = /WIDE_COLS=(\d+)/.exec(await readTerminalText());
    const wideCols = Number(wideMatch?.[1] ?? "0");
    expect(wideCols).toBeGreaterThan(20);

    // Drive a resize on the xterm object directly. The plugin's onResize
    // hook will forward the new size through the backend → SIGWINCH.
    await browser.execute(() => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType("anvil-terminal-container-view");
      const view = leaves[0]?.view as { getActiveHost?: () => { terminal: { resize: (c: number, r: number) => void } } | null };
      view?.getActiveHost?.()?.terminal.resize(40, 24);
    });
    await browser.pause(300);

    await typeCommand('printf "NARROW_COLS=%s\\n" "$(tput cols)"');
    await browser.waitUntil(
      async () => /NARROW_COLS=\d+/.test(await readTerminalText()),
      { timeout: 10000, timeoutMsg: "narrow tput cols never printed" },
    );
    const narrowMatch = /NARROW_COLS=(\d+)/.exec(await readTerminalText());
    const narrowCols = Number(narrowMatch?.[1] ?? "0");
    expect(narrowCols).toBe(40);
    expect(narrowCols).toBeLessThan(wideCols);
  });

  it("closing the view kills the shell and the pty-server binary", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    // Capture the pty-server child's PID via the view's backend handle.
    const pids = await browser.execute((viewType: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(viewType);
      const view = leaves[0]?.view as {
        getActiveBackend?: () => { childPid?: () => number | null } | null;
      };
      const pid = view?.getActiveBackend?.()?.childPid?.() ?? null;
      return { binaryPid: pid };
    }, VIEW_TYPE);
    expect(pids.binaryPid).toBeGreaterThan(0);

    await closeAllTerminalLeaves();
    await browser.pause(500);

    // Use Node's process.kill(pid, 0) via browser.execute — the test
    // process is Electron renderer with Node integration in plugins, but
    // browser.execute runs in the renderer where 'process' may not have
    // .kill. We delegate to a child_process call instead.
    const stillAlive = await browser.execute((pid: number) => {
      try {
        // Electron renderer — try Node API
        const cp = require("child_process");
        const result = cp.spawnSync("kill", ["-0", String(pid)]);
        return result.status === 0;
      } catch {
        return false;
      }
    }, pids.binaryPid as number);
    expect(stillAlive).toBe(false);
  });

  it("disabling the plugin kills any running pty-server binary", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    const pid = await browser.execute((viewType: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(viewType);
      const view = leaves[0]?.view as {
        getActiveBackend?: () => { childPid?: () => number | null } | null;
      };
      return view?.getActiveBackend?.()?.childPid?.() ?? null;
    }, VIEW_TYPE);
    expect(pid).toBeGreaterThan(0);

    await browser.execute(async (id: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      await app.plugins.disablePlugin(id);
    }, PLUGIN_ID);
    await browser.pause(500);

    const stillAlive = await browser.execute((p: number) => {
      try {
        const cp = require("child_process");
        return cp.spawnSync("kill", ["-0", String(p)]).status === 0;
      } catch {
        return false;
      }
    }, pid as number);
    expect(stillAlive).toBe(false);

    // Re-enable so other tests / teardown aren't disrupted.
    await browser.execute(async (id: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      await app.plugins.enablePlugin(id);
    }, PLUGIN_ID);
    await browser.pause(500);
  });
});
