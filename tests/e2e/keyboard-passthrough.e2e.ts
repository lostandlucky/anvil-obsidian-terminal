import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const VIEW_TYPE = "obsidian-terminal-view";

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type ObsidianWindow = Window & {
  app: {
    plugins: { plugins: Record<string, unknown> };
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
  await $(".obsidian-terminal-view .xterm").waitForExist({ timeout: 10000 });
}

async function focusTerminal() {
  await $(".obsidian-terminal-view .xterm-helper-textarea").waitForExist({
    timeout: 5000,
  });
  await browser.execute(() => {
    const ta = document.querySelector(
      ".obsidian-terminal-view .xterm-helper-textarea",
    ) as HTMLTextAreaElement | null;
    ta?.focus();
  });
}

async function readTerminalText(): Promise<string> {
  return browser.execute(() => {
    const rows = document.querySelector(
      ".obsidian-terminal-view .xterm-rows",
    );
    return rows ? (rows as HTMLElement).innerText : "";
  });
}

async function waitForShellReady() {
  await browser.waitUntil(
    async () => (await readTerminalText()).trim().length > 0,
    { timeout: 10000, timeoutMsg: "shell never produced output" },
  );
}

async function typeCommand(cmd: string) {
  await focusTerminal();
  await browser.keys(cmd.split(""));
  await browser.keys(["Enter"]);
}

describe("anvil-obsidian-terminal keyboard passthrough (FI-007)", function () {
  beforeEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  // RED — FI-007. A real Ctrl-C keypress must reach the PTY and interrupt a
  // running process. Previous Phase 2b e2e cheated by calling
  // backend.write("\x03") directly, which bypassed the keyboard pipeline.
  // This test drives the real keyboard path via WebdriverIO.
  it("Ctrl-C via real keyboard interrupts sleep and the shell recovers", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    await typeCommand("sleep 30");
    await browser.pause(500);

    // Real keyboard Ctrl-C. The terminal scope must NOT swallow this —
    // xterm needs to see the keydown so it can write \x03 to the PTY.
    await focusTerminal();
    await browser.keys(["Control", "c"]);
    await browser.pause(500);

    // Prove the shell is alive and receiving input by running another
    // command and waiting for its output.
    await typeCommand('printf "AFTER=%s\\n" alive');
    await browser.waitUntil(
      async () => /AFTER=alive/.test(await readTerminalText()),
      {
        timeout: 10000,
        timeoutMsg:
          "shell did not respond after real-keypress Ctrl-C — scope is still swallowing Ctrl-modifier keys",
      },
    );
  });

  // RED — FI-007 other side. Cmd-P must reach Obsidian's command palette
  // even while the terminal is focused. The current scope swallows all
  // Mod-modifier keys, which blocks the command palette from opening.
  it("Cmd-P while terminal is focused opens Obsidian's command palette", async function () {
    await openTerminal();
    await focusTerminal();
    await waitForShellReady();

    // Ensure no stray modal is open from a prior test.
    await closeAllModals();

    await focusTerminal();
    await browser.keys(["Meta", "p"]);

    // The command palette renders as .modal-container .prompt (same class
    // the picker uses, since they're both SuggestModal-derived).
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({
      timeout: 3000,
    });

    // Double-check this is Obsidian's command palette and not our picker —
    // our picker has .anvil-picker-* items, the command palette doesn't.
    const isCommandPalette = await browser.execute(() => {
      const anvilItems = document.querySelectorAll(".anvil-picker-item");
      const promptModal = document.querySelector(".modal-container .prompt");
      return Boolean(promptModal) && anvilItems.length === 0;
    });
    expect(isCommandPalette).toBe(true);
  });
});
