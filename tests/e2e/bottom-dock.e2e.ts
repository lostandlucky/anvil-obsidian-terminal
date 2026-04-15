import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const VIEW_TYPE = "obsidian-terminal-view";

type RootSplitLike = {
  direction?: string;
  children: unknown[];
};

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type ObsidianWindow = Window & {
  app: {
    plugins: {
      plugins: Record<string, unknown>;
    };
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
  await browser.executeAsync((id: string, done: (v: unknown) => void) => {
    const app = (window as unknown as ObsidianWindow).app;
    const plugin = app.plugins.plugins[id] as AnvilPluginLike;
    void plugin.openDefaultTerminal().then(() => done(null));
  }, PLUGIN_ID);
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

  // GREEN standing regression — covers the nested-split-container restore
  // path, which DOES work correctly. Opens two notes via the Obsidian
  // split-vertical command, opens and closes the dock, asserts the two
  // notes are still side-by-side (same y, different x).
  //
  // CAVEAT — this does NOT reproduce FI-002. The user's manual MT-006
  // reproduction involved a workspace shape where the two note leaves are
  // direct children of rootSplit (not wrapped in a nested container), and
  // reproducing that shape programmatically in the harness is nontrivial.
  // This test still guards the common case; the direct-child case stays
  // on the manual checklist until a fixture-workspace approach is built.
  // FI-002 is the tracking ticket for the real reproduction work.
  it("pre-existing split is visually restored after dock close (nested-container case)", async function () {
    // Ensure two notes exist in the fixture vault.
    await browser.executeAsync((done: (v: unknown) => void) => {
      const app = (window as unknown as {
        app: {
          vault: {
            create: (path: string, content: string) => Promise<unknown>;
            getAbstractFileByPath: (path: string) => unknown;
          };
        };
      }).app;
      const mk = async (p: string, body: string) => {
        const existing = app.vault.getAbstractFileByPath(p);
        if (!existing) await app.vault.create(p, body);
      };
      void Promise.all([
        mk("dock-restore-a.md", "# A\n"),
        mk("dock-restore-b.md", "# B\n"),
      ]).then(() => done(null));
    });

    // Build a 2-column vertical split in the main area using Obsidian's
    // own split command. This creates leaves as direct children of the
    // active tab container under rootSplit, matching the workspace shape
    // where FI-002 reproduces. openLinkText(..., "split") uses a nested
    // container path that bypasses the bug.
    await browser.executeAsync((done: (v: unknown) => void) => {
      const app = (window as unknown as {
        app: {
          commands: { executeCommandById: (id: string) => boolean };
          workspace: {
            openLinkText: (
              link: string,
              source: string,
              newLeaf: boolean | string,
            ) => Promise<void>;
            getActiveFile: () => unknown;
            getMostRecentLeaf: () => {
              openFile: (file: unknown) => Promise<void>;
            } | null;
          };
          vault: { getAbstractFileByPath: (p: string) => unknown };
        };
      }).app;
      (async () => {
        // 1. Open note A in the main area.
        await app.workspace.openLinkText("dock-restore-a", "", false);
        // 2. Use Obsidian's "Split vertically" command (creates a new
        //    sibling leaf in a vertical split boundary, i.e. side-by-side).
        app.commands.executeCommandById("workspace:split-vertical");
        // 3. Open note B in the newly-active leaf.
        const b = app.vault.getAbstractFileByPath("dock-restore-b.md");
        const activeLeaf = app.workspace.getMostRecentLeaf();
        if (activeLeaf && b) await activeLeaf.openFile(b);
      })().then(() => done(null));
    });
    await browser.pause(300);

    // Snapshot the geometry of the two markdown leaves BEFORE the dock opens.
    // Query via the workspace API for markdown leaves with a known file,
    // then read each leaf's containerEl bounding rect. This avoids the
    // trap of querying ".workspace-leaf" globally (which matches sidebar
    // leaves too) and instead anchors on the specific notes we created.
    const preRects = await browser.execute(() => {
      const app = (window as unknown as {
        app: {
          workspace: {
            getLeavesOfType: (type: string) => Array<{
              view: {
                file?: { path?: string };
                containerEl?: HTMLElement;
              };
            }>;
          };
        };
      }).app;
      const leaves = app.workspace.getLeavesOfType("markdown");
      const notes = leaves
        .filter((l) => {
          const p = l.view.file?.path ?? "";
          return p === "dock-restore-a.md" || p === "dock-restore-b.md";
        })
        .map((l) => {
          const el = l.view.containerEl;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            path: l.view.file?.path ?? "",
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      return notes;
    });

    // Should have exactly two note leaves. Both visible (non-zero area).
    expect(preRects.length).toBe(2);
    expect(preRects.every((r) => r.w > 50 && r.h > 50)).toBe(true);

    // Pre-dock: the two notes should be side-by-side — same y, different x.
    const [a, b] = preRects;
    const preSideBySide =
      Math.abs(a.y - b.y) < 20 && Math.abs(a.x - b.x) > 50;
    expect(preSideBySide).toBe(true);

    // Open the terminal. This flips rootSplit to horizontal, flattening
    // the columns into rows.
    await openTerminal();

    // Close the terminal. FI-002: direction property restores but children
    // do not reorient — the notes stay stacked as rows.
    await closeAllTerminalLeaves();

    // Give layout time to settle.
    await browser.pause(500);

    // Post-close geometry: the two notes should STILL be side-by-side,
    // not stacked as rows.
    const postRects = await browser.execute(() => {
      const app = (window as unknown as {
        app: {
          workspace: {
            getLeavesOfType: (type: string) => Array<{
              view: {
                file?: { path?: string };
                containerEl?: HTMLElement;
              };
            }>;
          };
        };
      }).app;
      const leaves = app.workspace.getLeavesOfType("markdown");
      return leaves
        .filter((l) => {
          const p = l.view.file?.path ?? "";
          return p === "dock-restore-a.md" || p === "dock-restore-b.md";
        })
        .map((l) => {
          const el = l.view.containerEl;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            path: l.view.file?.path ?? "",
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    });

    expect(postRects.length).toBe(2);
    expect(postRects.every((r) => r.w > 50 && r.h > 50)).toBe(true);
    const [postA, postB] = postRects;
    const postSideBySide =
      Math.abs(postA.y - postB.y) < 20 && Math.abs(postA.x - postB.x) > 50;
    expect(postSideBySide).toBe(true);

    // Cleanup: remove the fixture notes so subsequent tests start clean.
    await browser.executeAsync((done: (v: unknown) => void) => {
      const app = (window as unknown as {
        app: {
          vault: {
            getAbstractFileByPath: (p: string) => unknown;
            delete: (f: unknown) => Promise<void>;
          };
          workspace: { detachLeavesOfType: (t: string) => void };
        };
      }).app;
      const a = app.vault.getAbstractFileByPath("dock-restore-a.md");
      const b = app.vault.getAbstractFileByPath("dock-restore-b.md");
      app.workspace.detachLeavesOfType("markdown");
      void Promise.all([
        a ? app.vault.delete(a) : Promise.resolve(),
        b ? app.vault.delete(b) : Promise.resolve(),
      ]).then(() => done(null));
    });
  });
});
