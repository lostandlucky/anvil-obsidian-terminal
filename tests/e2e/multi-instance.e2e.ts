import { browser, expect, $, $$ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const VIEW_TYPE = "obsidian-terminal-view";

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type ObsidianWindow = Window & {
  app: {
    plugins: {
      plugins: Record<string, unknown>;
    };
    workspace: {
      getLeavesOfType: (type: string) => Array<{ detach(): void }>;
      detachLeavesOfType: (type: string) => void;
      trigger?: (name: string) => void;
    };
  };
};

async function closeAllTerminalLeaves() {
  await browser.execute((type: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    app.workspace.detachLeavesOfType(type);
    app.workspace.trigger?.("layout-change");
  }, VIEW_TYPE);
}

async function openDefaultTerminal() {
  await browser.executeAsync((id: string, done: (v: unknown) => void) => {
    const app = (window as unknown as ObsidianWindow).app;
    const plugin = app.plugins.plugins[id] as AnvilPluginLike;
    void plugin.openDefaultTerminal().then(() => done(null));
  }, PLUGIN_ID);
}

async function waitForLeafCount(target: number) {
  await browser.waitUntil(
    async () => {
      const count = await browser.execute((type: string) => {
        const app = (window as unknown as ObsidianWindow).app;
        return app.workspace.getLeavesOfType(type).length;
      }, VIEW_TYPE);
      return count === target;
    },
    {
      timeout: 8000,
      timeoutMsg: `expected ${target} terminal leaves`,
    },
  );
}

describe("anvil-obsidian-terminal multi-instance", function () {
  beforeEach(async function () {
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllTerminalLeaves();
  });

  it("registers a plus-icon action on the terminal view header", async function () {
    await openDefaultTerminal();
    await waitForLeafCount(1);

    const hasPlus = await browser.execute(() => {
      const actions = document.querySelectorAll(".view-actions *");
      for (const el of Array.from(actions)) {
        const aria = el.getAttribute("aria-label") ?? "";
        if (aria.includes("New terminal")) return true;
      }
      return false;
    });
    expect(hasPlus).toBe(true);
  });

  it("clicking the plus-icon opens a second terminal via openDefaultTerminal", async function () {
    await openDefaultTerminal();
    await waitForLeafCount(1);

    await browser.executeAsync((done: (v: unknown) => void) => {
      const nodes = Array.from(
        document.querySelectorAll(".view-actions *"),
      ) as HTMLElement[];
      const btn = nodes.find((el) =>
        (el.getAttribute("aria-label") ?? "").includes("New terminal"),
      );
      if (!btn) {
        done("no plus button");
        return;
      }
      btn.click();
      setTimeout(() => done(null), 1000);
    });

    await waitForLeafCount(2);
  });

  it("two concurrent terminals mount independent xterm hosts", async function () {
    await openDefaultTerminal();
    await waitForLeafCount(1);
    await openDefaultTerminal();
    await waitForLeafCount(2);

    const xtermCount = await $$(".obsidian-terminal-view .xterm");
    expect(await xtermCount.length).toBe(2);
  });

  it("closing one terminal leaves the other terminal intact", async function () {
    await openDefaultTerminal();
    await waitForLeafCount(1);
    await openDefaultTerminal();
    await waitForLeafCount(2);

    // Detach only the first leaf.
    await browser.execute((type: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(type);
      leaves[0]?.detach();
      app.workspace.trigger?.("layout-change");
    }, VIEW_TYPE);

    await waitForLeafCount(1);

    const stillMounted = await $(".obsidian-terminal-view .xterm").isExisting();
    expect(stillMounted).toBe(true);
  });
});
