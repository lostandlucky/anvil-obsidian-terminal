import { browser, expect, $, $$ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const COMMAND_ID = `${PLUGIN_ID}:open-terminal`;
const VIEW_TYPE = "obsidian-terminal-view";

type ObsidianWindow = Window & {
  app: {
    commands: {
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

async function triggerOpenTerminal() {
  await browser.execute((id: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    app.commands.executeCommandById(id);
  }, COMMAND_ID);
}

describe("anvil-obsidian-terminal profile picker", function () {
  beforeEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  it("executing the open-terminal command opens a modal, not a terminal", async function () {
    await triggerOpenTerminal();

    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    // No terminal view should have been mounted by opening the picker alone.
    const terminalMounted = await $(".obsidian-terminal-view .xterm").isExisting();
    expect(terminalMounted).toBe(false);
  });

  it("the picker renders a Launch new header and at least one shell suggestion", async function () {
    await triggerOpenTerminal();

    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    const suggestions = await $$(".suggestion-item.anvil-picker-item");
    const count = await suggestions.length;
    expect(count).toBeGreaterThan(0);

    const hasLaunchNewHeader = await browser.execute(() => {
      const headers = Array.from(
        document.querySelectorAll(".anvil-picker-header"),
      );
      return headers.some((h) => (h.textContent ?? "").includes("Launch new"));
    });
    expect(hasLaunchNewHeader).toBe(true);

    const hasShellRow = await $(".anvil-picker-shell").isExisting();
    expect(hasShellRow).toBe(true);
  });

  it("Escape dismisses the picker without opening a terminal", async function () {
    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    await browser.execute(() => {
      const input = document.querySelector(
        ".modal-container .prompt input",
      ) as HTMLInputElement | null;
      input?.focus();
      const ev = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      });
      (input ?? document.activeElement ?? document.body).dispatchEvent(ev);
    });

    await browser.waitUntil(
      async () => {
        const els = await $$(".modal-container .prompt");
        const count = await els.length;
        return count === 0;
      },
      { timeout: 2000, timeoutMsg: "picker modal did not dismiss on Escape" },
    );

    const terminalMounted = await $(".obsidian-terminal-view .xterm").isExisting();
    expect(terminalMounted).toBe(false);
  });
});
