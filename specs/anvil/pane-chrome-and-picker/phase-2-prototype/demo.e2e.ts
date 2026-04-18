// Walkthrough spec for Phase 2 Part 2. Not a verification test — long pauses
// so a human can watch the Obsidian window and see what each R8 probe does.
//
// Run one probe at a time:
//   npx wdio run ./wdio.proto.conf.mts \
//     --spec ./specs/anvil/pane-chrome-and-picker/phase-2-prototype/demo.e2e.ts \
//     --mochaOpts.grep='Demo R8a'
//
// Swap the grep pattern for R8b / R8c / R8d / R8e to step through.
//
// The "Demo 0" case shows the container opening and multi-tab state preservation.

import { browser, $ } from "@wdio/globals";

const VIEW_TYPE = "anvil-prototype-container-view";
const NOTE_PATH = "phase-2-r8-fixture.md";

type Leaf = {
  setViewState(state: unknown): Promise<void>;
  getViewState(): { type: string };
  view: { addTab?: () => Promise<void>; switchTab?: (id: string) => void };
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
    commands: {
      executeCommandById: (id: string) => boolean;
    };
    plugins: {
      plugins: Record<string, { openContainer?: () => Promise<void> }>;
    };
  };
};

const SLOW = 5000;
const SLOW_LONG = 8000;

async function resetWorkspace() {
  await browser.execute((type: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    app.workspace.detachLeavesOfType(type);
    app.workspace.detachLeavesOfType("markdown");
    app.workspace.trigger?.("layout-change");
  }, VIEW_TYPE);
}

async function ensureTestNote() {
  await browser.executeAsync(
    (path: string, done: (v: unknown) => void) => {
      const app = (window as unknown as ObsidianWindow).app;
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing) return done(null);
      void app.vault.create(path, "# R8 demo fixture\n").then(() => done(null));
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

async function openContainer() {
  await browser.executeAsync((viewType: string, done: (v: unknown) => void) => {
    const app = (window as unknown as ObsidianWindow).app;
    const plugin = app.plugins.plugins["anvil-prototype-container"];
    if (!plugin?.openContainer) return done("prototype plugin not loaded");
    void plugin.openContainer().then(() => {
      const leaves = app.workspace.getLeavesOfType(viewType);
      if (leaves[0]) app.workspace.setActiveLeaf(leaves[0], { focus: true });
      done(null);
    });
  }, VIEW_TYPE);
  await $(".anvil-proto-container .xterm").waitForExist({ timeout: 10000 });
}

async function report(label: string) {
  const state = await browser.execute(() => {
    const container = document.querySelector(".anvil-proto-container");
    const xterm = container?.querySelector(".xterm") as HTMLElement | null;
    const type = (window as unknown as ObsidianWindow).app.workspace
      .getLeavesOfType("anvil-prototype-container-view")[0]
      ?.getViewState?.()?.type;
    return {
      containerPresent: Boolean(container),
      xtermVisible: Boolean(xterm && xterm.offsetParent !== null),
      hasInsideMarkdown: Boolean(
        container?.querySelector(
          ".markdown-source-view, .markdown-preview-view",
        ),
      ),
      containerLeafViewType: type ?? null,
    };
  });
  // eslint-disable-next-line no-console
  console.log(`[DEMO] ${label}`, state);
}

describe("Phase 2 Part 2 — DEMO walkthrough", function () {
  before(async function () {
    await resetWorkspace();
    await ensureTestNote();
  });

  after(async function () {
    await resetWorkspace();
    await deleteTestNote();
  });

  it("Demo 0 — open the container, add a second tab, switch tabs, verify state preserved", async function () {
    await openContainer();
    await browser.pause(SLOW_LONG); // let user see the container with one terminal tab
    await browser.execute(() => {
      const app = (window as unknown as ObsidianWindow).app;
      app.commands.executeCommandById(
        "anvil-prototype-container:anvil-proto-add-tab",
      );
    });
    await browser.pause(SLOW); // second tab appears in side list
    // Type something in tab 2's terminal to make state visible
    await browser.execute(() => {
      const active = document.querySelector(
        ".anvil-proto-pane[style*='block'] .xterm-helper-textarea",
      ) as HTMLTextAreaElement | null;
      active?.focus();
      // synthesize a keystroke — Obsidian/xterm runs in real electron so this hits the PTY
      const evt = new KeyboardEvent("keydown", { key: "l", bubbles: true });
      active?.dispatchEvent(evt);
    });
    await browser.pause(SLOW_LONG);
    await report("Demo 0 — container with 2 tabs");
    await resetWorkspace();
  });

  it("Demo R8a — openLinkText(base, '', false) with container focused", async function () {
    await openContainer();
    await browser.pause(SLOW);
    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace.openLinkText(base, "", false).then(() => done(null));
      },
      NOTE_PATH,
    );
    await browser.pause(SLOW_LONG);
    await report("Demo R8a after openLinkText(false)");
    await resetWorkspace();
  });

  it("Demo R8b — openLinkText(base, '', 'tab') with container focused", async function () {
    await openContainer();
    await browser.pause(SLOW);
    await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const base = path.replace(/\.md$/, "");
        void app.workspace.openLinkText(base, "", "tab").then(() => done(null));
      },
      NOTE_PATH,
    );
    await browser.pause(SLOW_LONG);
    await report("Demo R8b after openLinkText('tab') — THIS IS THE FAILING PROBE");
    await resetWorkspace();
  });

  it("Demo R8c — openLinkText(base, '', 'split') with container focused", async function () {
    await openContainer();
    await browser.pause(SLOW);
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
    await browser.pause(SLOW_LONG);
    await report("Demo R8c after openLinkText('split')");
    await resetWorkspace();
  });

  it("Demo R8d — synthetic HTML5 drop on the container", async function () {
    await openContainer();
    await browser.pause(SLOW);
    await browser.execute((path: string) => {
      const container = document.querySelector(
        ".anvil-proto-container",
      ) as HTMLElement | null;
      if (!container) return;
      const dt = new DataTransfer();
      dt.setData("text/plain", path);
      dt.setData("text/uri-list", `obsidian://open?file=${path}`);
      container.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    }, NOTE_PATH);
    await browser.pause(SLOW_LONG);
    await report("Demo R8d after synthetic drop");
    await resetWorkspace();
  });

  it("Demo R8e — explicit leaf.setViewState({type:'markdown'}) on the container leaf", async function () {
    await openContainer();
    await browser.pause(SLOW);
    await browser.executeAsync(
      (viewType: string, notePath: string, done: (v: unknown) => void) => {
        const app = (window as unknown as ObsidianWindow).app;
        const leaf = app.workspace.getLeavesOfType(viewType)[0];
        if (!leaf) return done(null);
        void leaf
          .setViewState({
            type: "markdown",
            state: { file: notePath, mode: "source" },
          })
          .then(() => done(null));
      },
      VIEW_TYPE,
      NOTE_PATH,
    );
    await browser.pause(SLOW_LONG);
    await report(
      "Demo R8e after setViewState({type:'markdown'}) — regression pin; container expected to be clobbered",
    );
    await resetWorkspace();
  });
});
