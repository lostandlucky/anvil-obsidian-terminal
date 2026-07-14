// BUG-001 — workspace restore mounts the terminal as a sibling tab instead
// of bottom-docked (specs/anvil/known-bugs.md).
//
// The harness can't quit and relaunch the host Obsidian, so this spec uses
// the meta-plan's user-named in-process simulation of serialize→restore:
//
//   capture workspace.getLayout() → disable+enable the plugin (resets its
//   in-memory state exactly as a relaunch would) → workspace.changeLayout()
//   to rehydrate the captured JSON → assert the terminal ends up
//   bottom-docked with its tab strip intact and a working shell.
//
// Two restore variants:
//   AC1a — faithful roundtrip of the docked layout (whatever rehydration
//          does to the wrapper structure, the outcome must be docked).
//   AC1b — rehydrate a layout in which the terminal leaf sits as a sibling
//          tab next to the note — the exact shape a real relaunch produces
//          per the BUG-001 report. Guaranteed RED without the fix.
//
// Plus the no-fight requirement:
//   AC2  — a user-initiated leaf move (leaf identity preserved, as a real
//          in-window drag does) is respected: no redock, no redock loop.
//
// True quit-relaunch stays manual — MT-016 in manual-test-checklist.md.

import { browser, expect } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const CONTAINER_VIEW_TYPE = "anvil-terminal-container-view";
const NOTE = "bug001-note.md";

type LeafLike = {
  detach(): void;
  setViewState(s: unknown): Promise<void>;
  parent?: unknown;
  view?: unknown;
};

type Ws = Window & {
  app: {
    plugins: {
      plugins: Record<string, { openDefaultTerminal: () => Promise<void> }>;
      disablePlugin: (id: string) => Promise<void>;
      enablePlugin: (id: string) => Promise<void>;
    };
    workspace: {
      rootSplit: { direction?: string; children: unknown[] };
      layoutReady: boolean;
      getLayout: () => Record<string, unknown>;
      changeLayout: (layout: Record<string, unknown>) => Promise<void>;
      getLeaf: (newLeaf?: boolean | string) => LeafLike;
      getLeavesOfType: (t: string) => Array<LeafLike & { view: unknown }>;
      detachLeavesOfType: (t: string) => void;
      trigger?: (n: string) => void;
    };
    vault: {
      create: (p: string, c: string) => Promise<unknown>;
      delete: (f: unknown) => Promise<void>;
      getAbstractFileByPath: (p: string) => unknown;
    };
  };
};

// ---------------------------------------------------------------- helpers

async function ensureNote() {
  await browser.executeAsync((p: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    const run = async () => {
      if (!app.vault.getAbstractFileByPath(p)) await app.vault.create(p, `# ${p}\n`);
    };
    void run().then(() => done(null));
  }, NOTE);
}

async function deleteNote() {
  await browser.executeAsync((p: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    const run = async () => {
      const f = app.vault.getAbstractFileByPath(p);
      if (f) await app.vault.delete(f);
    };
    void run().then(() => done(null));
  }, NOTE);
}

async function resetWorkspace() {
  await browser.executeAsync((viewType: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    for (const t of ["markdown", "empty", viewType]) {
      try {
        app.workspace.detachLeavesOfType(t);
      } catch {
        /* */
      }
    }
    setTimeout(() => done(null), 100);
  }, CONTAINER_VIEW_TYPE);
}

async function openNote() {
  await browser.executeAsync((p: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    const leaf = app.workspace.getLeaf(false);
    void leaf
      .setViewState({ type: "markdown", state: { file: p, mode: "source" } })
      .then(() => done(null));
  }, NOTE);
}

async function openTerminalViaPlugin() {
  await browser.executeAsync((id: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    void app.plugins.plugins[id].openDefaultTerminal().then(() => done(null));
  }, PLUGIN_ID);
}

/** Read the active terminal's xterm buffer (same pattern as pty-backend.e2e). */
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
    const app = (window as unknown as Ws).app;
    const leaves = app.workspace.getLeavesOfType(viewType);
    if (!leaves.length) return "";
    const host = (leaves[0].view as ViewLike).getActiveHost?.();
    if (!host) return "";
    const buf = host.terminal.buffer.active;
    const out: string[] = [];
    for (let r = 0; r < buf.length; r += 1) {
      const ln = buf.getLine(r);
      if (ln) out.push(ln.translateToString(true));
    }
    return out.join("\n");
  }, CONTAINER_VIEW_TYPE);
}

async function waitForShellReady() {
  await browser.waitUntil(
    async () => (await readTerminalText()).trim().length > 0,
    { timeout: 10000, timeoutMsg: "shell never produced output" },
  );
  await browser.pause(300);
}

type DockSnapshot = {
  terminalLeafCount: number;
  rootDirection: string | undefined;
  underRoot: boolean;
  inBottomSlot: boolean;
  sharesTabsWithForeignView: boolean;
  tabStripTabCount: number;
  noteLeafCount: number;
};

/** Structural truth about where the terminal leaf lives. */
async function snapshotDockState(): Promise<DockSnapshot> {
  return browser.execute((viewType: string) => {
    const app = (window as unknown as Ws).app;
    const rs = app.workspace.rootSplit as unknown;
    const leaves = app.workspace.getLeavesOfType(viewType);
    const snapshot = {
      terminalLeafCount: leaves.length,
      rootDirection: (rs as { direction?: string }).direction,
      underRoot: false,
      inBottomSlot: false,
      sharesTabsWithForeignView: false,
      tabStripTabCount: 0,
      noteLeafCount: app.workspace.getLeavesOfType("markdown").length,
    };
    if (leaves.length === 0) return snapshot;
    const leaf = leaves[0] as unknown as {
      parent?: unknown;
      view?: { containerEl?: HTMLElement };
    };

    // Ancestor chain reaches rootSplit?
    let node: unknown = leaf.parent;
    while (node) {
      if (node === rs) {
        snapshot.underRoot = true;
        break;
      }
      node = (node as { parent?: unknown }).parent;
    }

    // Bottom slot: the leaf itself — or its immediate tabs wrapper — is a
    // DIRECT child of rootSplit (not nested inside the notes wrapper).
    const parent = leaf.parent as { parent?: unknown; children?: unknown[] } | undefined;
    snapshot.inBottomSlot = parent === rs || (parent ? parent.parent === rs : false);

    // Sibling-tab bug shape: the leaf's immediate parent contains a leaf
    // with a non-terminal view (e.g. the note).
    if (parent && Array.isArray(parent.children)) {
      for (const child of parent.children) {
        const v = (child as { view?: { getViewType?: () => string } }).view;
        const t = v?.getViewType?.();
        if (t && t !== viewType) snapshot.sharesTabsWithForeignView = true;
      }
    }

    const el = leaf.view?.containerEl;
    snapshot.tabStripTabCount = el
      ? el.querySelectorAll(".anvil-terminal-tabstrip .anvil-terminal-tab").length
      : 0;
    return snapshot;
  }, CONTAINER_VIEW_TYPE);
}

function isDocked(s: DockSnapshot): boolean {
  return (
    s.terminalLeafCount === 1 &&
    s.rootDirection === "horizontal" &&
    s.underRoot &&
    s.inBottomSlot &&
    !s.sharesTabsWithForeignView &&
    s.tabStripTabCount >= 1
  );
}

/**
 * Simulate quit→relaunch: reset the plugin's in-memory state (fresh WeakSet,
 * fresh wrapHandle — exactly what a real relaunch gives it), then rehydrate
 * the captured layout. The explicit layout-change trigger matches existing
 * suite practice after programmatic layout surgery.
 */
async function simulateRestore(layout: Record<string, unknown>) {
  await browser.executeAsync(
    (id: string, l: Record<string, unknown>, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      const run = async () => {
        await app.plugins.disablePlugin(id);
        await app.plugins.enablePlugin(id);
        await app.workspace.changeLayout(l);
        app.workspace.trigger?.("layout-change");
      };
      void run().then(() => done(null)).catch((e: Error) => done(`threw:${e.message}`));
    },
    PLUGIN_ID,
    layout,
  );
}

async function waitForDocked(label: string) {
  let last: DockSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await snapshotDockState();
        if (!isDocked(last)) return false;
        return (await readTerminalText()).trim().length > 0;
      },
      { timeout: 20000 },
    );
  } catch {
    throw new Error(
      `${label}: terminal never reached the docked state — last snapshot ${JSON.stringify(last)}`,
    );
  }
}

// ------------------------------------------------- layout JSON transforms

type LayoutNode = {
  id?: string;
  type?: string;
  direction?: string;
  children?: LayoutNode[];
  state?: { type?: string; state?: unknown };
  currentTab?: number;
};

function findLeafNode(node: LayoutNode | undefined, viewType: string): LayoutNode | null {
  if (!node) return null;
  if (node.type === "leaf" && node.state?.type === viewType) return node;
  for (const child of node.children ?? []) {
    const hit = findLeafNode(child, viewType);
    if (hit) return hit;
  }
  return null;
}

/**
 * Build the exact layout shape a real relaunch produces per the BUG-001
 * report: the terminal leaf as a top-level tab NEXT TO the note, in a plain
 * vertical rootSplit — no wrapper, no dock. Reuses the leaf nodes from a
 * genuinely captured layout so ids/state payloads stay realistic.
 */
function buildSiblingTabLayout(captured: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(captured)) as Record<string, unknown>;
  const main = clone.main as LayoutNode | undefined;
  const terminalNode = findLeafNode(main, CONTAINER_VIEW_TYPE);
  const noteNode = findLeafNode(main, "markdown");
  if (!terminalNode || !noteNode) {
    throw new Error(
      `captured layout is missing expected leaves (terminal=${!!terminalNode}, note=${!!noteNode})`,
    );
  }
  clone.main = {
    id: main?.id ?? "root",
    type: "split",
    direction: "vertical",
    children: [
      {
        id: "bug001-tabs",
        type: "tabs",
        children: [noteNode, terminalNode],
        currentTab: 0,
      },
    ],
  } satisfies LayoutNode;
  return clone;
}

// ------------------------------------------------------------------ tests

describe("BUG-001 restore-path redock", function () {
  before(async function () {
    await ensureNote();
  });

  after(async function () {
    await resetWorkspace();
    await deleteNote();
  });

  beforeEach(async function () {
    await resetWorkspace();
  });

  it("AC1a roundtrip — a captured docked layout rehydrates back to bottom-docked", async function () {
    await openNote();
    await openTerminalViaPlugin();
    await waitForShellReady();

    const layout = (await browser.execute(() =>
      (window as unknown as Ws).app.workspace.getLayout(),
    )) as Record<string, unknown>;

    await simulateRestore(layout);
    await waitForDocked("AC1a");

    const s = await snapshotDockState();
    expect(s.terminalLeafCount).toBe(1);
    expect(s.rootDirection).toBe("horizontal");
    expect(s.underRoot).toBe(true);
    expect(s.inBottomSlot).toBe(true);
    expect(s.sharesTabsWithForeignView).toBe(false);
    expect(s.tabStripTabCount).toBeGreaterThanOrEqual(1);
    expect(s.noteLeafCount).toBeGreaterThanOrEqual(1);
  });

  it("AC1b observed relaunch shape — terminal restored as a sibling tab gets redocked", async function () {
    await openNote();
    await openTerminalViaPlugin();
    await waitForShellReady();

    const layout = (await browser.execute(() =>
      (window as unknown as Ws).app.workspace.getLayout(),
    )) as Record<string, unknown>;
    const siblingTabLayout = buildSiblingTabLayout(layout);

    await simulateRestore(siblingTabLayout);
    await waitForDocked("AC1b");

    const s = await snapshotDockState();
    expect(s.terminalLeafCount).toBe(1);
    expect(s.rootDirection).toBe("horizontal");
    expect(s.underRoot).toBe(true);
    expect(s.inBottomSlot).toBe(true);
    // The load-bearing BUG-001 assertion: no terminal tab left sitting next
    // to the note for the user to clean up.
    expect(s.sharesTabsWithForeignView).toBe(false);
    expect(s.tabStripTabCount).toBeGreaterThanOrEqual(1);
    expect(s.noteLeafCount).toBeGreaterThanOrEqual(1);
  });

  it("AC2 no-fight — a user-initiated leaf move is respected, no redock loop", async function () {
    await openNote();
    await openTerminalViaPlugin();
    await waitForShellReady();

    // Simulate a deliberate in-window drag: move the SAME leaf object into
    // the note's tabs group (real drags preserve leaf identity). Marker on
    // the leaf lets us assert identity afterwards.
    const moved = (await browser.execute((viewType: string) => {
      const app = (window as unknown as Ws).app;
      const term = app.workspace.getLeavesOfType(viewType)[0] as unknown as {
        parent?: { removeChild?: (c: unknown) => void };
        __bug001Marker?: string;
      };
      const note = app.workspace.getLeavesOfType("markdown")[0] as unknown as {
        parent?: {
          children?: unknown[];
          insertChild?: (i: number, c: unknown) => void;
        };
      };
      if (!term || !note) return "missing-leaves";
      const tabs = note.parent;
      const from = term.parent;
      if (!tabs?.insertChild || !from?.removeChild || !Array.isArray(tabs.children)) {
        return "missing-api";
      }
      term.__bug001Marker = "user-moved";
      from.removeChild(term);
      tabs.insertChild(tabs.children.length, term);
      app.workspace.trigger?.("layout-change");
      return "moved";
    }, CONTAINER_VIEW_TYPE)) as string;
    expect(moved).toBe("moved");

    await browser.pause(500);

    const check = async () =>
      browser.execute((viewType: string) => {
        const app = (window as unknown as Ws).app;
        const leaves = app.workspace.getLeavesOfType(viewType);
        if (leaves.length !== 1) return `leafCount:${leaves.length}`;
        const term = leaves[0] as unknown as {
          parent?: { children?: unknown[] };
          __bug001Marker?: string;
        };
        if (term.__bug001Marker !== "user-moved") return "leaf-was-replaced";
        const siblings = term.parent?.children ?? [];
        const hasNoteSibling = siblings.some((c) => {
          const v = (c as { view?: { getViewType?: () => string } }).view;
          return v?.getViewType?.() === "markdown";
        });
        return hasNoteSibling ? "respected" : "not-in-note-tabs";
      }, CONTAINER_VIEW_TYPE);

    expect(await check()).toBe("respected");

    // Fire layout-change again — a redock loop would yank the leaf back.
    await browser.execute(() => {
      (window as unknown as Ws).app.workspace.trigger?.("layout-change");
    });
    await browser.pause(500);
    expect(await check()).toBe("respected");
  });
});
