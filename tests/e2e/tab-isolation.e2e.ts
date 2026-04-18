// Phase 3 — AC9: R8 isolation probes against the terminal container view.
//
// Rewritten from the single-leaf `TerminalView` target to the multi-tab
// `TerminalContainerView` target. R8a–R8e ported from the Phase 2 prototype
// (specs/anvil/pane-chrome-and-picker/phase-2-prototype/r8.e2e.ts).
//
// Load-bearing properties Phase 3 must preserve (ADR 0006):
//   R8a (default openLinkText) — carried by `view.navigation = false`
//   R8b (openLinkText("tab"))  — carried by placement (createLeafInParent
//                                under rootSplit, no WorkspaceTabs wrapper)
//   R8c (openLinkText("split")) — carried by placement
//   R8d (HTML5 drop onto container) — carried by no drop handler
//   R8e (explicit setViewState clobber) — regression-pinned. Documented
//       residual: not blockable within sanctioned API.

import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const CONTAINER_VIEW_TYPE = "anvil-terminal-container-view";
const NOTE_PATH = "tab-isolation-test.md";

type Leaf = {
  view: { getViewType?: () => string };
  detach(): void;
  setViewState(s: unknown): Promise<void>;
  getViewState(): { type: string };
};

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type Ws = Window & {
  app: {
    plugins: { plugins: Record<string, AnvilPluginLike> };
    vault: {
      create: (p: string, c: string) => Promise<unknown>;
      delete: (f: unknown) => Promise<void>;
      getAbstractFileByPath: (p: string) => unknown;
    };
    workspace: {
      getLeavesOfType: (t: string) => Leaf[];
      detachLeavesOfType: (t: string) => void;
      setActiveLeaf: (l: Leaf, opts?: unknown) => void;
      openLinkText: (l: string, s: string, n: boolean | string) => Promise<void>;
      trigger?: (n: string) => void;
    };
  };
};

async function closeAllContainerLeaves() {
  await browser.execute((t: string) => {
    const app = (window as unknown as Ws).app;
    app.workspace.detachLeavesOfType(t);
    app.workspace.trigger?.("layout-change");
  }, CONTAINER_VIEW_TYPE);
}

async function ensureTestNote() {
  await browser.executeAsync(
    (path: string, done: (v: unknown) => void) => {
      const app = (window as unknown as Ws).app;
      if (app.vault.getAbstractFileByPath(path)) return done(null);
      void app.vault.create(path, "# R8 fixture\n").then(() => done(null));
    },
    NOTE_PATH,
  );
}

async function deleteTestNote() {
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

async function openContainerAndActivate() {
  await browser.executeAsync((id: string, t: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    const plugin = app.plugins.plugins[id];
    void plugin.openDefaultTerminal().then(() => {
      const leaves = app.workspace.getLeavesOfType(t);
      if (leaves[0]) app.workspace.setActiveLeaf(leaves[0], { focus: true });
      done(null);
    });
  }, PLUGIN_ID, CONTAINER_VIEW_TYPE);
  await $(".anvil-terminal-container-view .xterm").waitForExist({ timeout: 10000 });
}

type IsolationReport = {
  containerLeafCount: number;
  containerXtermVisible: boolean;
  noteLeafFound: boolean;
  hasInsideMarkdown: boolean;
};

async function collectReport(): Promise<IsolationReport> {
  return browser.execute(
    (viewType: string, notePath: string) => {
      const app = (window as unknown as Ws).app;
      const termLeaves = app.workspace.getLeavesOfType(viewType);

      let noteLeafFound = false;
      for (const t of ["markdown", "empty"]) {
        for (const leaf of app.workspace.getLeavesOfType(t)) {
          const file = (leaf as unknown as { view?: { file?: { path?: string } } })
            .view?.file?.path;
          if (file === notePath) {
            noteLeafFound = true;
            break;
          }
        }
        if (noteLeafFound) break;
      }

      const container = document.querySelector(".anvil-terminal-container-view");
      const xterm = container?.querySelector(".xterm") as HTMLElement | null;
      const containerXtermVisible = Boolean(xterm && xterm.offsetParent !== null);
      const hasInsideMarkdown = Boolean(
        container?.querySelector(".markdown-source-view, .markdown-preview-view"),
      );

      return {
        containerLeafCount: termLeaves.length,
        containerXtermVisible,
        noteLeafFound,
        hasInsideMarkdown,
      };
    },
    CONTAINER_VIEW_TYPE,
    NOTE_PATH,
  );
}

function assertIsolation(report: IsolationReport, label: string) {
  expect(report.containerLeafCount).toBeGreaterThanOrEqual(1);
  expect(report.containerXtermVisible).toBe(true);
  expect(report.hasInsideMarkdown).toBe(false);
  expect(report.noteLeafFound).toBe(true);
  if (!report.containerXtermVisible || report.hasInsideMarkdown) {
    throw new Error(
      `${label}: container isolation regressed — xtermVisible=${report.containerXtermVisible}, hasInsideMarkdown=${report.hasInsideMarkdown}.`,
    );
  }
}

describe("Phase 3 — R8 isolation probes against container view", function () {
  beforeEach(async function () {
    await closeAllContainerLeaves();
    await ensureTestNote();
  });

  afterEach(async function () {
    await closeAllContainerLeaves();
    await deleteTestNote();
  });

  it("R8a — openLinkText(base, '', false) does not land the note inside the container", async function () {
    await openContainerAndActivate();

    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as Ws).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace.openLinkText(base, "", false).then(() => done(null));
      },
      NOTE_PATH,
    );

    const report = await collectReport();
    assertIsolation(report, "R8a openLinkText(false)");
  });

  it("R8b — openLinkText(base, '', 'tab') does not sibling-into the container's tab group", async function () {
    await openContainerAndActivate();

    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as Ws).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace.openLinkText(base, "", "tab").then(() => done(null));
      },
      NOTE_PATH,
    );

    const report = await collectReport();
    assertIsolation(report, "R8b openLinkText(tab)");
  });

  it("R8c — openLinkText(base, '', 'split') does not replace or split the container", async function () {
    await openContainerAndActivate();

    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as Ws).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace.openLinkText(base, "", "split").then(() => done(null));
      },
      NOTE_PATH,
    );

    const report = await collectReport();
    assertIsolation(report, "R8c openLinkText(split)");
  });

  it("R8d — synthetic HTML5 drop on the container does not mix a note inside", async function () {
    await openContainerAndActivate();

    await browser.execute((path: string) => {
      const container = document.querySelector(
        ".anvil-terminal-container-view",
      ) as HTMLElement | null;
      if (!container) return;
      const dt = new DataTransfer();
      dt.setData("text/plain", path);
      dt.setData("text/uri-list", `obsidian://open?file=${path}`);
      const ev = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      container.dispatchEvent(ev);
    }, NOTE_PATH);

    // Absence-of-change check — no DOM write we can wait *for*. The drop
    // would either be ignored (desired) or would inject markdown into the
    // container asynchronously. Poll for "markdown appeared" up to 1s;
    // if it never appears, the container stayed clean.
    await browser
      .waitUntil(
        async () => {
          const has = await browser.execute(() => {
            const c = document.querySelector(".anvil-terminal-container-view");
            return !!c?.querySelector(".markdown-source-view, .markdown-preview-view");
          });
          return !!has;
        },
        { timeout: 1000, timeoutMsg: "no markdown injected (expected)" },
      )
      .catch(() => {
        /* timeout is the success case here */
      });

    const state = await browser.execute(() => {
      const container = document.querySelector(".anvil-terminal-container-view");
      const xterm = container?.querySelector(".xterm") as HTMLElement | null;
      return {
        containerXtermVisible: Boolean(xterm && xterm.offsetParent !== null),
        hasInsideMarkdown: Boolean(
          container?.querySelector(
            ".markdown-source-view, .markdown-preview-view",
          ),
        ),
      };
    });

    expect(state.containerXtermVisible).toBe(true);
    expect(state.hasInsideMarkdown).toBe(false);
    if (!state.containerXtermVisible || state.hasInsideMarkdown) {
      throw new Error(
        `R8d synthetic drop: container isolation regressed — xtermVisible=${state.containerXtermVisible}, hasInsideMarkdown=${state.hasInsideMarkdown}.`,
      );
    }
  });

  it("R8e — explicit leaf.setViewState({type:'markdown'}) replaces the container (documented residual — regression-pin)", async function () {
    await openContainerAndActivate();

    const postType = (await browser.executeAsync(
      (viewType: string, notePath: string, done: (v: unknown) => void) => {
        const app = (window as unknown as Ws).app;
        const leaves = app.workspace.getLeavesOfType(viewType);
        const leaf = leaves[0];
        if (!leaf) return done("no-container-leaf");
        void leaf
          .setViewState({
            type: "markdown",
            state: { file: notePath, mode: "source" },
          })
          .then(() => {
            setTimeout(() => {
              const vs = leaf.getViewState();
              done(vs?.type ?? "unknown");
            }, 300);
          })
          .catch((err: Error) => {
            done(`threw:${err.message}`);
          });
      },
      CONTAINER_VIEW_TYPE,
      NOTE_PATH,
    )) as string;

    // Regression-pin: R8e is NOT blockable within sanctioned API. If this
    // assertion flips (postType !== "markdown"), the container's mitigations
    // changed behavior and ADR 0006's "Harder" section needs revisiting.
    expect(postType).toBe("markdown");
  });
});
