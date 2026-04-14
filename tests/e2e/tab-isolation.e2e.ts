import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const VIEW_TYPE = "obsidian-terminal-view";
const NOTE_PATH = "tab-isolation-test.md";

type AnvilPluginLike = {
  openDefaultTerminal: () => Promise<void>;
};

type Leaf = {
  view: { getViewType?: () => string };
  parent?: unknown;
  detach(): void;
};

type ObsidianWindow = Window & {
  app: {
    plugins: { plugins: Record<string, unknown> };
    vault: {
      create: (path: string, content: string) => Promise<unknown>;
      adapter: { exists: (p: string) => Promise<boolean> };
      delete: (file: unknown) => Promise<void>;
      getAbstractFileByPath: (p: string) => unknown;
    };
    workspace: {
      getLeavesOfType: (type: string) => Leaf[];
      detachLeavesOfType: (type: string) => void;
      setActiveLeaf: (leaf: Leaf, options?: unknown) => void;
      getMostRecentLeaf: () => Leaf | null;
      openLinkText: (
        linktext: string,
        sourcePath: string,
        newLeaf: boolean | string,
      ) => Promise<void>;
      trigger?: (name: string) => void;
      rootSplit: { children: unknown[] };
    };
    commands: {
      executeCommandById: (id: string) => boolean;
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
        .create(path, "# tab isolation fixture\n")
        .then(() => done(null));
    },
    NOTE_PATH,
  );
}

async function openTerminalAndActivate() {
  await browser.executeAsync((id: string, done: (v: unknown) => void) => {
    const app = (window as unknown as ObsidianWindow).app;
    const plugin = app.plugins.plugins[id] as AnvilPluginLike;
    void plugin.openDefaultTerminal().then(() => {
      const leaves = app.workspace.getLeavesOfType("obsidian-terminal-view");
      if (leaves[0]) app.workspace.setActiveLeaf(leaves[0], { focus: true });
      done(null);
    });
  }, PLUGIN_ID);
  await $(".obsidian-terminal-view .xterm").waitForExist({ timeout: 5000 });
}

type IsolationReport = {
  terminalLeafCount: number;
  terminalXtermVisible: boolean;
  noteLeafFound: boolean;
};

async function assertIsolation(report: IsolationReport, label: string) {
  // "Not replaced" — the terminal leaf still exists.
  expect(report.terminalLeafCount).toBeGreaterThanOrEqual(1);
  // "Not sibling-into" — the terminal is still visible to the user, not
  // hidden behind the note in a shared tab container. This is the real
  // user-facing concern per spec D8.
  expect(report.terminalXtermVisible).toBe(true);
  // Sanity: the note actually opened somewhere.
  expect(report.noteLeafFound).toBe(true);
  if (!report.terminalXtermVisible) {
    throw new Error(
      `${label}: terminal xterm is no longer visible — STOP and surface per D8.`,
    );
  }
}

async function collectReport(): Promise<IsolationReport> {
  return browser.execute((terminalType: string, notePath: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    const termLeaves = app.workspace.getLeavesOfType(terminalType);

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

    const xterm = document.querySelector(
      ".obsidian-terminal-view .xterm",
    ) as HTMLElement | null;
    const terminalXtermVisible = Boolean(xterm && xterm.offsetParent !== null);

    return {
      terminalLeafCount: termLeaves.length,
      terminalXtermVisible,
      noteLeafFound,
    };
  }, VIEW_TYPE, NOTE_PATH);
}

describe("anvil-obsidian-terminal tab-group isolation (D8 verify-don't-implement)", function () {
  beforeEach(async function () {
    await closeAllTerminalLeaves();
    await ensureTestNote();
  });

  afterEach(async function () {
    await closeAllTerminalLeaves();
    await deleteTestNote();
  });

  it("workspace.openLinkText (quick-switcher / programmatic) does not replace or sibling-into the terminal leaf", async function () {
    await openTerminalAndActivate();

    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace.openLinkText(base, "", false).then(() => done(null));
      },
      NOTE_PATH,
    );

    const report = await collectReport();
    await assertIsolation(
      report,
      "workspace.openLinkText default mode",
    );
  });

  it("workspace.openLinkText with tab modifier (Cmd-click) does not replace or sibling-into the terminal leaf", async function () {
    await openTerminalAndActivate();

    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace.openLinkText(base, "", "tab").then(() => done(null));
      },
      NOTE_PATH,
    );

    const report = await collectReport();
    await assertIsolation(report, "workspace.openLinkText tab modifier");
  });

  it("workspace.openLinkText with split modifier does not replace or sibling-into the terminal leaf", async function () {
    await openTerminalAndActivate();

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
    await assertIsolation(report, "workspace.openLinkText split modifier");
  });

  it("a synthetic HTML5 drop event with a note-path DataTransfer does not mix the terminal and the note into one tab group", async function () {
    await openTerminalAndActivate();

    // Dispatch a drop event with an Obsidian-style DataTransfer payload into
    // the terminal view's container. If anything reacts to the drop by
    // placing a note leaf under the same parent, that's the regression.
    await browser.execute((path: string) => {
      const container = document.querySelector(
        ".obsidian-terminal-view",
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

    // Give the layout a moment to react if it's going to.
    await browser.pause(300);

    const state = await browser.execute(() => {
      const xterm = document.querySelector(
        ".obsidian-terminal-view .xterm",
      ) as HTMLElement | null;
      return {
        terminalXtermVisible: Boolean(xterm && xterm.offsetParent !== null),
      };
    });

    if (!state.terminalXtermVisible) {
      throw new Error(
        "drop event regression: terminal xterm is no longer visible after a synthetic HTML5 drop. STOP and surface per D8.",
      );
    }
    expect(state.terminalXtermVisible).toBe(true);
  });
});
