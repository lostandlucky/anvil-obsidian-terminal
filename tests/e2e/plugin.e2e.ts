import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const COMMAND_ID = `${PLUGIN_ID}:open-terminal`;
const VIEW_TYPE = "obsidian-terminal-view";

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type ObsidianWindow = Window & {
  app: {
    plugins: {
      plugins: Record<string, unknown>;
      enabledPlugins: Set<string>;
    };
    commands: {
      commands: Record<string, unknown>;
      executeCommandById: (id: string) => boolean;
    };
    workspace: {
      getLeavesOfType: (type: string) => Array<{ detach(): void }>;
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

async function closeAllModals() {
  await browser.execute(() => {
    document
      .querySelectorAll(".modal-container")
      .forEach((el) => el.remove());
  });
}

async function openTerminal() {
  await browser.executeAsync((id: string, done: (v: unknown) => void) => {
    const app = (window as unknown as ObsidianWindow).app;
    const plugin = app.plugins.plugins[id] as AnvilPluginLike;
    void plugin.openDefaultTerminal().then(() => done(null));
  }, PLUGIN_ID);
  await $(".obsidian-terminal-view .xterm").waitForExist({ timeout: 5000 });
}

async function readTerminalText(): Promise<string> {
  return browser.execute(() => {
    const rows = document.querySelector(
      ".obsidian-terminal-view .xterm-rows",
    );
    return rows ? (rows as HTMLElement).innerText : "";
  });
}

async function focusTerminal() {
  const textarea = await $(".obsidian-terminal-view .xterm-helper-textarea");
  await textarea.waitForExist({ timeout: 5000 });
  await browser.execute(() => {
    const ta = document.querySelector(
      ".obsidian-terminal-view .xterm-helper-textarea",
    ) as HTMLTextAreaElement | null;
    ta?.focus();
  });
}

describe("anvil-obsidian-terminal", function () {
  beforeEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  it("loads as an enabled plugin", async function () {
    const loaded = await browser.execute((id: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      return (
        Boolean(app.plugins.plugins[id]) && app.plugins.enabledPlugins.has(id)
      );
    }, PLUGIN_ID);
    expect(loaded).toBe(true);
  });

  it("registers the open-terminal command", async function () {
    const registered = await browser.execute((id: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      return Boolean(app.commands.commands[id]);
    }, COMMAND_ID);
    expect(registered).toBe(true);
  });

  it("executing the command mounts xterm in an ItemView", async function () {
    await openTerminal();
    const exists = await $(".obsidian-terminal-view .xterm").isExisting();
    expect(exists).toBe(true);

    const hasScreen = await $(
      ".obsidian-terminal-view .xterm-screen",
    ).isExisting();
    expect(hasScreen).toBe(true);
  });

  it("renders a real shell prompt, not the mock REPL", async function () {
    await openTerminal();
    // Wait for the shell to print something. We don't assert on a specific
    // prompt character because that varies by shell — just that nothing
    // mock-related is on screen and the buffer is non-empty.
    await browser.waitUntil(
      async () => (await readTerminalText()).trim().length > 0,
      { timeout: 10000, timeoutMsg: "shell never produced output" },
    );
    const text = await readTerminalText();
    expect(text).not.toContain("mock>");
    expect(text).not.toContain("Obsidian Terminal — type 'help'");
  });

  it("Ctrl-C dispatched inside the focused terminal reaches xterm but not Obsidian", async function () {
    // Two-sided contract (FI-007 / Phase 3.5 AC3):
    //   (a) Obsidian's document-level handler must NOT see the keydown.
    //   (b) xterm's textarea MUST see the keydown at target phase.
    // Pre-Phase-3.5 this only asserted (a), and passed for the wrong reason —
    // the catch-all scope was killing the event before xterm could process it.
    await openTerminal();
    await focusTerminal();

    const result = await browser.execute(() => {
      let documentSawCtrlC = false;
      let targetSawCtrlC = false;
      const documentProbe = (ev: KeyboardEvent) => {
        if (ev.ctrlKey && ev.key === "c") documentSawCtrlC = true;
      };
      const ta = document.querySelector(
        ".obsidian-terminal-view .xterm-helper-textarea",
      ) as HTMLElement | null;
      const targetProbe = (ev: KeyboardEvent) => {
        if (ev.ctrlKey && ev.key === "c") targetSawCtrlC = true;
      };
      document.addEventListener("keydown", documentProbe);
      ta?.addEventListener("keydown", targetProbe);
      try {
        ta?.focus();
        const ev = new KeyboardEvent("keydown", {
          key: "c",
          code: "KeyC",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        ta?.dispatchEvent(ev);
        return { documentSawCtrlC, targetSawCtrlC };
      } finally {
        document.removeEventListener("keydown", documentProbe);
        ta?.removeEventListener("keydown", targetProbe);
      }
    });
    expect(result.documentSawCtrlC).toBe(false);
    expect(result.targetSawCtrlC).toBe(true);
  });

  it("closing and reopening the terminal leaves no console errors", async function () {
    const before = await browser.getLogs("browser").catch(() => []);
    const baselineErrors = before.filter((e) =>
      /severe/i.test((e as { level?: string }).level ?? ""),
    ).length;

    await openTerminal();
    await closeAllTerminalLeaves();
    await openTerminal();

    const after = await browser.getLogs("browser").catch(() => []);
    const errors = after.filter((e) =>
      /severe/i.test((e as { level?: string }).level ?? ""),
    );
    expect(errors.length).toBeLessThanOrEqual(baselineErrors);
  });
});
