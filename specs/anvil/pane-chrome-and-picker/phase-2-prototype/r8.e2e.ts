// R8 isolation probes against the Phase 2 Part 1 prototype container view.
//
// Throwaway spec, Phase 2 Part 2 scope. Not in tests/e2e/ deliberately —
// see specs/anvil/pane-chrome-and-picker/phase-2-workspace-container-part-2-spec.md.
//
// Pattern mirrors tests/e2e/tab-isolation.e2e.ts:162–255 but targets the
// Rank 3 container's DOM (`.anvil-proto-container`) and view type
// (`anvil-prototype-container-view`). Helpers are inline-copied rather than
// imported — the spec is throwaway.

import { browser, expect, $ } from "@wdio/globals";

const VIEW_TYPE = "anvil-prototype-container-view";
const NOTE_PATH = "phase-2-r8-fixture.md";

type Leaf = {
  view: { getViewType?: () => string };
  detach(): void;
  setViewState(state: unknown): Promise<void>;
  getViewState(): { type: string };
};

type ObsidianWindow = Window & {
  app: {
    vault: {
      create: (path: string, content: string) => Promise<unknown>;
      delete: (file: unknown) => Promise<void>;
      getAbstractFileByPath: (p: string) => unknown;
    };
    workspace: {
      getLeavesOfType: (type: string) => Leaf[];
      detachLeavesOfType: (type: string) => void;
      setActiveLeaf: (leaf: Leaf, options?: unknown) => void;
      getLeaf: (newLeaf: "split", direction: "horizontal" | "vertical") => Leaf;
      openLinkText: (
        linktext: string,
        sourcePath: string,
        newLeaf: boolean | string,
      ) => Promise<void>;
      trigger?: (name: string) => void;
    };
    plugins: {
      plugins: Record<string, { openContainer?: () => Promise<void> }>;
    };
  };
};

async function closeAllContainerLeaves() {
  await browser.execute((type: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    app.workspace.detachLeavesOfType(type);
    app.workspace.trigger?.("layout-change");
  }, VIEW_TYPE);
}

async function ensureTestNote() {
  await browser.executeAsync(
    (path: string, done: (v: unknown) => void) => {
      const app = (window as unknown as ObsidianWindow).app;
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing) {
        done(null);
        return;
      }
      void app.vault
        .create(path, "# R8 fixture\n")
        .then(() => done(null));
    },
    NOTE_PATH,
  );
}

async function deleteTestNote() {
  await browser.executeAsync(
    (path: string, done: (v: unknown) => void) => {
      const app = (window as unknown as ObsidianWindow).app;
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing) {
        void app.vault.delete(existing).then(() => done(null));
        return;
      }
      done(null);
    },
    NOTE_PATH,
  );
}

async function openContainerAndActivate() {
  // Drive the prototype's own openContainer path, which uses
  // createLeafInParent(rootSplit, ...) — the tab-group-less placement
  // that gives us R8b isolation. Synthesizing our own leaf here would
  // bypass that path and test a different thing.
  await browser.executeAsync((viewType: string, done: (v: unknown) => void) => {
    const app = (window as unknown as ObsidianWindow).app;
    const plugin = app.plugins.plugins["anvil-prototype-container"];
    if (!plugin?.openContainer) {
      done("prototype plugin not loaded");
      return;
    }
    void plugin.openContainer().then(() => {
      const leaves = app.workspace.getLeavesOfType(viewType);
      if (leaves[0]) app.workspace.setActiveLeaf(leaves[0], { focus: true });
      done(null);
    });
  }, VIEW_TYPE);
  await $(".anvil-proto-container .xterm").waitForExist({ timeout: 10000 });
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
      const app = (window as unknown as ObsidianWindow).app;
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

      const container = document.querySelector(".anvil-proto-container");
      const xterm = container?.querySelector(".xterm") as HTMLElement | null;
      const containerXtermVisible = Boolean(
        xterm && xterm.offsetParent !== null,
      );
      const hasInsideMarkdown = Boolean(
        container?.querySelector(
          ".markdown-source-view, .markdown-preview-view",
        ),
      );

      return {
        containerLeafCount: termLeaves.length,
        containerXtermVisible,
        noteLeafFound,
        hasInsideMarkdown,
      };
    },
    VIEW_TYPE,
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

describe("Phase 2 Part 2 — R8 isolation probes against Rank 3 container", function () {
  beforeEach(async function () {
    await closeAllContainerLeaves();
    await ensureTestNote();
  });

  afterEach(async function () {
    await closeAllContainerLeaves();
    await deleteTestNote();
  });

  it("R8a — workspace.openLinkText(base, '', false) does not land the note inside the container", async function () {
    await openContainerAndActivate();

    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace.openLinkText(base, "", false).then(() => done(null));
      },
      NOTE_PATH,
    );

    const report = await collectReport();
    assertIsolation(report, "R8a openLinkText(false)");
  });

  it("R8b — workspace.openLinkText(base, '', 'tab') does not land the note inside the container", async function () {
    await openContainerAndActivate();

    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace.openLinkText(base, "", "tab").then(() => done(null));
      },
      NOTE_PATH,
    );

    const report = await collectReport();
    assertIsolation(report, "R8b openLinkText(tab)");
  });

  it("R8c — workspace.openLinkText(base, '', 'split') does not land the note inside the container", async function () {
    await openContainerAndActivate();

    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace
          .openLinkText(base, "", "split")
          .then(() => done(null));
      },
      NOTE_PATH,
    );

    const report = await collectReport();
    assertIsolation(report, "R8c openLinkText(split)");
  });

  it("R8d — synthetic HTML5 drop on the container does not mix the note inside", async function () {
    await openContainerAndActivate();

    await browser.execute((path: string) => {
      const container = document.querySelector(
        ".anvil-proto-container",
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

    await browser.pause(300);

    const state = await browser.execute(() => {
      const container = document.querySelector(".anvil-proto-container");
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

  it("R8e — explicit leaf.setViewState({type:'markdown'}) replaces the container view (documented residual)", async function () {
    await openContainerAndActivate();

    const postType = (await browser.executeAsync(
      (viewType: string, notePath: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const leaves = app.workspace.getLeavesOfType(viewType);
        const leaf = leaves[0];
        if (!leaf) {
          done("no-container-leaf");
          return;
        }
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
      VIEW_TYPE,
      NOTE_PATH,
    )) as string;

    // Regression-pin per Phase 2 Part 2 spec D4:
    // setPinned(true) + view.navigation = false do NOT block an explicit
    // setViewState. If this assertion flips (postType !== "markdown"), the
    // prototype's mitigations changed behavior and ADR 0006's "Harder"
    // section needs revisiting.
    expect(postType).toBe("markdown");
  });
});
