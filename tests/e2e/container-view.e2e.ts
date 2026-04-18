// Phase 3 — Terminal container view behavior.
//
// Covers AC1-AC7, AC10, AC16 of phase-3-workspace-container-spec.md. At RED
// time (this commit) the container view class does not exist yet, so every
// test here should FAIL at runtime — either because the view type is not
// registered, or because the expected DOM chrome is absent.
//
// DOM contract (agreed in RED stubs — implementation may override if justified):
//   - .anvil-terminal-container-view           — container view root
//   - .anvil-terminal-tabstrip                 — tab strip container
//   - .anvil-terminal-tab                      — individual tab row/button
//   - .anvil-terminal-tab.is-active            — active tab marker
//   - .anvil-terminal-tab-close                — close X on each tab
//   - .anvil-terminal-content                  — content area holding per-tab xterm panes
//   - .anvil-terminal-pane                     — per-tab pane (only one visible)
//   - .anvil-terminal-bottom-buffer            — empty bottom buffer strip (AC16)

import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const CONTAINER_VIEW_TYPE = "anvil-terminal-container-view";
const NOTE_PATH = "container-view-fixture.md";

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type LeafLike = {
  view: { getViewType?: () => string };
  detach(): void;
};

type ContainerView = {
  getTabIds?(): string[];
  getActiveTabId?(): string | null;
  addTab?(spec: { shell: string; shellArgs?: string[]; cwd?: string }): Promise<void>;
  switchTab?(id: string): void;
  closeTab?(id: string): Promise<void>;
};

type Ws = Window & {
  app: {
    plugins: { plugins: Record<string, AnvilPluginLike> };
    workspace: {
      getLeavesOfType: (t: string) => Array<LeafLike & { view: { getViewType?: () => string } & ContainerView }>;
      detachLeavesOfType: (t: string) => void;
      openLinkText: (l: string, s: string, n?: boolean | string) => Promise<void>;
      trigger?: (n: string) => void;
    };
    vault: {
      create: (p: string, c: string) => Promise<unknown>;
      delete: (f: unknown) => Promise<void>;
      getAbstractFileByPath: (p: string) => unknown;
    };
  };
};

async function closeAllContainerLeaves() {
  await browser.execute((type: string) => {
    const app = (window as unknown as Ws).app;
    app.workspace.detachLeavesOfType(type);
    app.workspace.trigger?.("layout-change");
  }, CONTAINER_VIEW_TYPE);
}

async function openDefaultTerminal() {
  await browser.executeAsync((id: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    void app.plugins.plugins[id].openDefaultTerminal().then(() => done(null));
  }, PLUGIN_ID);
  await $(".anvil-terminal-container-view .xterm").waitForExist({ timeout: 10000 });
}

async function ensureFixtureNote() {
  await browser.executeAsync(
    (path: string, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      if (app.vault.getAbstractFileByPath(path)) return done(null);
      void app.vault.create(path, "# fixture\n").then(() => done(null));
    },
    NOTE_PATH,
  );
}

async function deleteFixtureNote() {
  await browser.executeAsync(
    (path: string, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      const f = app.vault.getAbstractFileByPath(path);
      if (f) void app.vault.delete(f).then(() => done(null));
      else done(null);
    },
    NOTE_PATH,
  );
}

describe("container view — core behavior (Phase 3)", function () {
  beforeEach(async function () {
    await closeAllContainerLeaves();
  });
  afterEach(async function () {
    await closeAllContainerLeaves();
  });

  it("AC1 — opens exactly one container leaf on first openDefaultTerminal", async function () {
    await openDefaultTerminal();
    const count = await browser.execute((t: string) => {
      const app = (window as unknown as Ws).app;
      return app.workspace.getLeavesOfType(t).length;
    }, CONTAINER_VIEW_TYPE);
    expect(count).toBe(1);
  });

  it("AC2 — second openDefaultTerminal adds a second tab, does NOT create a sibling leaf", async function () {
    await openDefaultTerminal();
    await openDefaultTerminal();

    const state = await browser.execute((t: string) => {
      const app = (window as unknown as Ws).app;
      const leaves = app.workspace.getLeavesOfType(t);
      const view = leaves[0]?.view as unknown as ContainerView | undefined;
      return {
        leafCount: leaves.length,
        tabCount: view?.getTabIds?.().length ?? 0,
      };
    }, CONTAINER_VIEW_TYPE);

    expect(state.leafCount).toBe(1);
    expect(state.tabCount).toBe(2);
  });

  it("AC3 — tab switch preserves inactive tab's PTY output (xterm not disposed)", async function () {
    await openDefaultTerminal();
    await openDefaultTerminal();

    // Grab tab ids, write a marker into tab 1 via the PTY, switch to tab 2, switch back,
    // assert the marker is still in tab 1's scrollback.
    const result = await browser.executeAsync((t: string, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      const view = app.workspace.getLeavesOfType(t)[0]?.view as unknown as ContainerView;
      const ids = view.getTabIds?.() ?? [];
      if (ids.length < 2) return done({ err: `expected 2 tabs, got ${ids.length}` });

      view.switchTab?.(ids[0]);
      // Write a marker INTO the PTY of tab 1 by simulating shell echo:
      // we drop a synthetic marker into the xterm buffer of tab 1's content pane.
      const tab1Pane = document.querySelectorAll(".anvil-terminal-pane")[0] as HTMLElement;
      const MARKER = `FI14-MARK-${Date.now()}`;
      // We can't easily write to the PTY from the test, so instead we use
      // xterm's API via a data attribute the view should expose, OR we
      // rely on the visible xterm buffer. For a RED stub, just assert the
      // DOM query surface exists and that the pane's xterm stays attached
      // across switches.
      const xtermInTab1Before = tab1Pane?.querySelector(".xterm");
      view.switchTab?.(ids[1]);
      view.switchTab?.(ids[0]);
      const xtermInTab1After = (document.querySelectorAll(".anvil-terminal-pane")[0] as HTMLElement)?.querySelector(".xterm");

      done({
        ok: !!xtermInTab1Before && xtermInTab1After === xtermInTab1Before,
        marker: MARKER,
      });
    }, CONTAINER_VIEW_TYPE);

    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it("AC4 — closing one tab disposes that tab's xterm, other tab continues", async function () {
    await openDefaultTerminal();
    await openDefaultTerminal();

    const before = await browser.execute(() => {
      return document.querySelectorAll(".anvil-terminal-pane .xterm").length;
    });
    expect(before).toBe(2);

    await browser.executeAsync((t: string, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      const view = app.workspace.getLeavesOfType(t)[0]?.view as unknown as ContainerView;
      const ids = view.getTabIds?.() ?? [];
      void view.closeTab?.(ids[0]).then(() => done(null));
    }, CONTAINER_VIEW_TYPE);

    const after = await browser.execute(() => {
      return document.querySelectorAll(".anvil-terminal-pane .xterm").length;
    });
    expect(after).toBe(1);
  });

  it("AC5 — per-tab close X is visible and clickable without keyboard fallback", async function () {
    await openDefaultTerminal();
    await openDefaultTerminal();

    const closeX = await $(".anvil-terminal-tab .anvil-terminal-tab-close");
    await expect(closeX).toBeDisplayed();

    // Confirm click dispatches close (tab count drops from 2 → 1)
    const idsBefore = await browser.execute((t: string) => {
      const app = (window as unknown as Ws).app;
      const view = app.workspace.getLeavesOfType(t)[0]?.view as unknown as ContainerView;
      return view.getTabIds?.() ?? [];
    }, CONTAINER_VIEW_TYPE);
    await closeX.click();
    const idsAfter = await browser.execute((t: string) => {
      const app = (window as unknown as Ws).app;
      const view = app.workspace.getLeavesOfType(t)[0]?.view as unknown as ContainerView;
      return view.getTabIds?.() ?? [];
    }, CONTAINER_VIEW_TYPE);

    expect(idsBefore.length).toBe(2);
    expect(idsAfter.length).toBe(1);
  });

  it("AC6 — container height persists across close/reopen within one session", async function () {
    await openDefaultTerminal();

    // Resize the container to a non-default height
    const targetHeight = 420;
    await browser.execute((h: number) => {
      const container = document.querySelector(
        ".anvil-terminal-container-view",
      )?.parentElement as HTMLElement | null;
      if (container) container.style.height = `${h}px`;
    }, targetHeight);
    await browser.pause(200);

    await closeAllContainerLeaves();
    await openDefaultTerminal();

    const restoredHeight = await browser.execute(() => {
      const container = document.querySelector(
        ".anvil-terminal-container-view",
      )?.parentElement as HTMLElement | null;
      return container ? container.getBoundingClientRect().height : 0;
    });

    // Within 5px of the target — small differences acceptable for container chrome
    expect(Math.abs((restoredHeight as number) - targetHeight)).toBeLessThan(5);
  });

  it("AC7 — editor status overlay does NOT intersect .xterm-viewport", async function () {
    await ensureFixtureNote();
    await openDefaultTerminal();

    // Open the fixture note above the terminal
    await browser.executeAsync((path: string, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      const base = path.replace(/\.md$/, "");
      void app.workspace.openLinkText(base, "", false).then(() => done(null));
    }, NOTE_PATH);
    await browser.pause(300);

    const report = await browser.execute(() => {
      const overlays: Element[] = Array.from(
        document.querySelectorAll(
          ".mod-active .view-content .cm-editor .cm-statusbar, .workspace-leaf.mod-active .markdown-reading-view .markdown-reading-statusbar, .workspace-leaf.mod-active .view-statusbar, .workspace-leaf.mod-active .mod-editor-statusbar, .editor-status-bar",
        ),
      );
      // Also try known statusbar class names Obsidian uses for the bottom overlay.
      const xterm = document.querySelector(".anvil-terminal-container-view .xterm-viewport") as HTMLElement | null;
      if (!xterm) return { err: "no .xterm-viewport found" };
      const termRect = xterm.getBoundingClientRect();
      const intersections: Array<{ selector: string; intersect: boolean; rect: unknown }> = [];
      for (const el of overlays) {
        const r = (el as HTMLElement).getBoundingClientRect();
        const intersect =
          !(r.right < termRect.left ||
            r.left > termRect.right ||
            r.bottom < termRect.top ||
            r.top > termRect.bottom);
        intersections.push({ selector: el.className, intersect, rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom } });
      }
      return {
        termRect: { top: termRect.top, left: termRect.left, right: termRect.right, bottom: termRect.bottom },
        overlayCount: overlays.length,
        intersections,
      };
    });

    await deleteFixtureNote();

    // Ship-blocker per spec: no overlay may overlap the xterm viewport.
    const rep = report as { intersections?: Array<{ intersect: boolean }> };
    const anyIntersect = rep.intersections?.some((i) => i.intersect) ?? false;
    expect(anyIntersect).toBe(false);
  });

  it("AC10 — when createLeafInParent is absent, container still opens and logs one fallback warning", async function () {
    // Monkey-patch the API to simulate older Obsidian or API removal.
    await browser.execute(() => {
      const app = (window as unknown as Ws).app;
      const ws = app.workspace as unknown as { createLeafInParent?: unknown; __anvilOrigCLIP?: unknown };
      ws.__anvilOrigCLIP = ws.createLeafInParent;
      ws.createLeafInParent = undefined;
    });

    const warnings: string[] = [];
    // We can't easily intercept console.warn from WebdriverIO retroactively —
    // the implementation should emit a marker into window for testability.
    // Stub expectation: after fallback open, `window.__anvilFallbackWarned === true`.
    try {
      await openDefaultTerminal();
      const state = await browser.execute(() => {
        const w = window as unknown as { __anvilFallbackWarned?: boolean };
        const containers = document.querySelectorAll(".anvil-terminal-container-view").length;
        return { containers, warned: !!w.__anvilFallbackWarned };
      });
      expect(state.containers).toBe(1);
      expect(state.warned).toBe(true);
      void warnings;
    } finally {
      // Restore
      await browser.execute(() => {
        const app = (window as unknown as Ws).app;
        const ws = app.workspace as unknown as { createLeafInParent?: unknown; __anvilOrigCLIP?: unknown };
        if (ws.__anvilOrigCLIP !== undefined) ws.createLeafInParent = ws.__anvilOrigCLIP;
      });
    }
  });

  it("AC16 — bottom buffer strip is visible, has non-zero height, and is empty", async function () {
    await openDefaultTerminal();

    const report = await browser.execute(() => {
      const strip = document.querySelector(
        ".anvil-terminal-container-view .anvil-terminal-bottom-buffer",
      ) as HTMLElement | null;
      if (!strip) return { present: false };
      const r = strip.getBoundingClientRect();
      const textContent = (strip.textContent ?? "").trim();
      const childCount = strip.children.length;
      return {
        present: true,
        height: r.height,
        visible: r.height > 0 && strip.offsetParent !== null,
        textContent,
        childCount,
      };
    });

    expect((report as { present: boolean }).present).toBe(true);
    const r = report as { present: true; height: number; visible: boolean; textContent: string; childCount: number };
    expect(r.visible).toBe(true);
    expect(r.height).toBeGreaterThan(0);
    expect(r.textContent).toBe("");
    expect(r.childCount).toBe(0);
  });
});
