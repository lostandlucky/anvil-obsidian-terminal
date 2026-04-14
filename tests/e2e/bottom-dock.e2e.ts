import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const COMMAND_ID = `${PLUGIN_ID}:open-terminal`;
const VIEW_TYPE = "obsidian-terminal-view";

type RootSplitLike = {
  direction?: string;
  children: unknown[];
};

type ObsidianWindow = Window & {
  app: {
    commands: {
      executeCommandById: (id: string) => boolean;
    };
    workspace: {
      rootSplit: RootSplitLike;
      getLeavesOfType: (type: string) => Array<{
        detach(): void;
        parent?: unknown;
      }>;
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

async function openTerminal() {
  await browser.execute((id: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    app.commands.executeCommandById(id);
  }, COMMAND_ID);
  await $(".obsidian-terminal-view .xterm").waitForExist({ timeout: 5000 });
}

async function getRootSplitDirection(): Promise<string | undefined> {
  return browser.execute(() => {
    const app = (window as unknown as ObsidianWindow).app;
    return app.workspace.rootSplit?.direction;
  });
}

async function terminalIsChildOfRootSplit(): Promise<boolean> {
  return browser.execute((type: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    const leaves = app.workspace.getLeavesOfType(type);
    if (leaves.length === 0) return false;
    const rootSplit = app.workspace.rootSplit as unknown as {
      children: unknown[];
    };
    // Walk up the leaf's parent chain; rootSplit must be an ancestor.
    for (const leaf of leaves) {
      let node: unknown = (leaf as unknown as { parent?: unknown }).parent;
      while (node) {
        if (node === (rootSplit as unknown)) return true;
        node = (node as { parent?: unknown }).parent;
      }
    }
    return false;
  }, VIEW_TYPE);
}

describe("anvil-obsidian-terminal bottom dock", function () {
  beforeEach(async function () {
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllTerminalLeaves();
  });

  it("opening a terminal flips rootSplit to horizontal and places the leaf under rootSplit", async function () {
    const preDirection = await getRootSplitDirection();

    await openTerminal();

    const direction = await getRootSplitDirection();
    expect(direction).toBe("horizontal");

    const underRoot = await terminalIsChildOfRootSplit();
    expect(underRoot).toBe(true);

    // Restore for afterEach to not leave a flipped workspace.
    await closeAllTerminalLeaves();
    const restored = await getRootSplitDirection();
    expect(restored).toBe(preDirection);
  });

  it("closing the last terminal leaf restores the original rootSplit direction", async function () {
    const preDirection = await getRootSplitDirection();

    await openTerminal();
    expect(await getRootSplitDirection()).toBe("horizontal");

    await closeAllTerminalLeaves();

    // Give layout-change event time to fire + reconcile.
    await browser.waitUntil(
      async () => (await getRootSplitDirection()) === preDirection,
      { timeout: 3000, timeoutMsg: "rootSplit direction was not restored" },
    );
  });
});
