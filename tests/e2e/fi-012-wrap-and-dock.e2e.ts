// Phase 3 — AC15: FI-012 wrap-and-dock.
//
// With two notes open side-by-side, opening the terminal must preserve the
// side-by-side columns and dock the container as a full-width row below.
// Closing the container must restore the original rootSplit layout exactly.
//
// Spike proof: specs/anvil/pane-chrome-and-picker/phase-3-fi-012-spike-findings.md
// (recipe: hijack createLeafBySplit to build wrapper, reparent siblings into
// it, flip rs direction, dock container as sibling of wrapper).
//
// RED expectation: today's BottomDock flips rootSplit.direction blindly,
// flattening columns into rows. No nested wrapper is created.

import { browser, expect } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const CONTAINER_VIEW_TYPE = "anvil-terminal-container-view";
const NOTE_A = "fi012-wrap-a.md";
const NOTE_B = "fi012-wrap-b.md";

type Spec = { shell: string };

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type LeafLike = {
  detach(): void;
  setViewState(s: unknown): Promise<void>;
  parent?: unknown;
};

type SplitLike = {
  direction?: string;
  children: unknown[];
};

type Ws = Window & {
  app: {
    plugins: { plugins: Record<string, AnvilPluginLike> };
    workspace: {
      rootSplit: SplitLike;
      getLeaf: (newLeaf?: boolean | string) => LeafLike;
      createLeafBySplit?: (l: LeafLike, dir?: string, before?: boolean) => LeafLike;
      getLeavesOfType: (t: string) => Array<LeafLike & { view: unknown }>;
      detachLeavesOfType: (t: string) => void;
      setActiveLeaf: (l: LeafLike, opts?: unknown) => void;
      trigger?: (n: string) => void;
    };
    vault: {
      create: (p: string, c: string) => Promise<unknown>;
      delete: (f: unknown) => Promise<void>;
      getAbstractFileByPath: (p: string) => unknown;
    };
  };
};

async function ensureNotes() {
  await browser.executeAsync((a: string, b: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    const ensure = async (p: string) => {
      if (!app.vault.getAbstractFileByPath(p)) await app.vault.create(p, `# ${p}\n`);
    };
    void Promise.all([ensure(a), ensure(b)]).then(() => done(null));
  }, NOTE_A, NOTE_B);
}

async function deleteNotes() {
  await browser.executeAsync((a: string, b: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    const drop = async (p: string) => {
      const f = app.vault.getAbstractFileByPath(p);
      if (f) await app.vault.delete(f);
    };
    void Promise.all([drop(a), drop(b)]).then(() => done(null));
  }, NOTE_A, NOTE_B);
}

async function resetWorkspace() {
  await browser.executeAsync((viewType: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    for (const t of ["markdown", "empty", viewType, "obsidian-terminal-view"]) {
      try { app.workspace.detachLeavesOfType(t); } catch { /* */ }
    }
    setTimeout(() => done(null), 100);
  }, CONTAINER_VIEW_TYPE);
}

async function buildSideBySideColumns() {
  await browser.executeAsync(
    (a: string, b: string, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      (async () => {
        const leafA = app.workspace.getLeaf(false);
        await leafA.setViewState({ type: "markdown", state: { file: a, mode: "source" } });
        app.workspace.setActiveLeaf(leafA, { focus: true });
        const leafB = app.workspace.createLeafBySplit!.call(
          app.workspace,
          leafA,
          "vertical",
          false,
        );
        await leafB.setViewState({ type: "markdown", state: { file: b, mode: "source" } });
        done(null);
      })();
    },
    NOTE_A,
    NOTE_B,
  );
}

type TreeSnapshot = {
  direction: string | undefined;
  childCount: number;
  childShapes: Array<{
    ctor: string;
    direction: string | null | undefined;
    grandchildCount: number;
  }>;
};

async function snapshotRootSplit(): Promise<TreeSnapshot> {
  return browser.execute(() => {
    const app = (window as unknown as Ws).app;
    const rs = app.workspace.rootSplit;
    return {
      direction: rs.direction,
      childCount: rs.children.length,
      childShapes: rs.children.map((c) => {
        const co = c as { direction?: string | null; children?: unknown[] };
        return {
          ctor: Object.getPrototypeOf(co)?.constructor?.name ?? "?",
          direction: co.direction,
          grandchildCount: Array.isArray(co.children) ? co.children.length : 0,
        };
      }),
    };
  }) as Promise<TreeSnapshot>;
}

describe("FI-012 wrap-and-dock (AC15)", function () {
  before(async function () {
    await ensureNotes();
  });
  after(async function () {
    await resetWorkspace();
    await deleteNotes();
  });
  beforeEach(async function () {
    await resetWorkspace();
  });

  it("AC15 forward — side-by-side notes preserved when container opens", async function () {
    await buildSideBySideColumns();

    const before = await snapshotRootSplit();
    expect(before.childCount).toBe(2);
    expect(before.direction).toBe("vertical");

    await browser.executeAsync((id: string, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      void app.plugins.plugins[id].openDefaultTerminal().then(() => done(null));
    }, PLUGIN_ID);

    const after = await snapshotRootSplit();
    // Expected shape:
    //   rootSplit(horizontal) → [ split(vertical) → [tabs(A), tabs(B)], container-leaf ]
    expect(after.direction).toBe("horizontal");
    expect(after.childCount).toBe(2);
    // First child is a nested WorkspaceSplit with direction = original ("vertical"), 2 grandchildren
    expect(after.childShapes[0].direction).toBe("vertical");
    expect(after.childShapes[0].grandchildCount).toBe(2);
    // Second child is the container's tab group (1 grandchild = the container leaf)
    expect(after.childShapes[1].grandchildCount).toBeGreaterThanOrEqual(1);
  });

  it("AC15 reverse — closing container restores original rootSplit layout exactly", async function () {
    await buildSideBySideColumns();

    const before = await snapshotRootSplit();

    // Open container, then close all container leaves
    await browser.executeAsync((id: string, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      void app.plugins.plugins[id].openDefaultTerminal().then(() => done(null));
    }, PLUGIN_ID);
    await browser.execute((t: string) => {
      const app = (window as unknown as Ws).app;
      app.workspace.detachLeavesOfType(t);
      app.workspace.trigger?.("layout-change");
    }, CONTAINER_VIEW_TYPE);

    const after = await snapshotRootSplit();

    // rootSplit should be back to direction=vertical with two flat children
    expect(after.direction).toBe(before.direction);
    expect(after.childCount).toBe(before.childCount);
    expect(after.childShapes[0].grandchildCount).toBe(before.childShapes[0].grandchildCount);
    expect(after.childShapes[1].grandchildCount).toBe(before.childShapes[1].grandchildCount);
  });
});
