import { browser, expect, $, $$ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const COMMAND_ID = `${PLUGIN_ID}:open-terminal`;
const VIEW_TYPE = "obsidian-terminal-view";

type ObsidianWindow = Window & {
  app: {
    commands: {
      executeCommandById: (id: string) => boolean;
    };
    workspace: {
      getLeavesOfType: (type: string) => Array<{
        view: unknown;
        detach(): void;
      }>;
      detachLeavesOfType: (type: string) => void;
    };
  };
};

async function closeAllTerminalLeaves() {
  await browser.execute((type: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    app.workspace.detachLeavesOfType(type);
  }, VIEW_TYPE);
}

async function closeAllModals() {
  await browser.execute(() => {
    document
      .querySelectorAll(".modal-container")
      .forEach((el) => el.remove());
  });
}

async function triggerOpenTerminal() {
  await browser.execute((id: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    app.commands.executeCommandById(id);
  }, COMMAND_ID);
}

describe("anvil-obsidian-terminal profile picker", function () {
  beforeEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  it("executing the open-terminal command opens a modal, not a terminal", async function () {
    await triggerOpenTerminal();

    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    // No terminal view should have been mounted by opening the picker alone.
    const terminalMounted = await $(".obsidian-terminal-view .xterm").isExisting();
    expect(terminalMounted).toBe(false);
  });

  it("the picker renders a Launch new header and at least one shell suggestion", async function () {
    await triggerOpenTerminal();

    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    const suggestions = await $$(".suggestion-item.anvil-picker-item");
    const count = await suggestions.length;
    expect(count).toBeGreaterThan(0);

    const hasLaunchNewHeader = await browser.execute(() => {
      const headers = Array.from(
        document.querySelectorAll(".anvil-picker-header"),
      );
      return headers.some((h) => (h.textContent ?? "").includes("Launch new"));
    });
    expect(hasLaunchNewHeader).toBe(true);

    const hasShellRow = await $(".anvil-picker-shell").isExisting();
    expect(hasShellRow).toBe(true);
  });

  // GREEN standing regression — catches the original slice-6 gap where
  // the default shell was badge-marked but not actually pre-selected.
  // Inspects chooser.selectedItem after onOpen instead of relying on a
  // human to eyeball the highlight.
  it("default shell row is pre-selected via chooser.selectedItem on picker open", async function () {
    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    // Look up the index of the row whose title contains "(default)" and
    // compare against whatever the SuggestModal chooser has selected.
    const result = await browser.execute(() => {
      const items = Array.from(
        document.querySelectorAll(".suggestion-item.anvil-picker-item"),
      );
      const defaultIdx = items.findIndex((el) =>
        ((el.textContent ?? "").includes("(default)")),
      );
      const selected = document.querySelector(
        ".suggestion-item.is-selected",
      );
      const selectedIdx = selected ? items.indexOf(selected) : -1;
      return { defaultIdx, selectedIdx };
    });

    expect(result.defaultIdx).toBeGreaterThanOrEqual(0);
    expect(result.selectedIdx).toBe(result.defaultIdx);
  });

  // GREEN standing regression — catches FI-008 (tmux-discovery dynamic
  // import silently broken). If tmux is on PATH, the picker MUST render
  // the "New tmux session" row. Skips if tmux isn't available on the
  // test host so CI machines without tmux don't fail spuriously.
  it("picker renders the New tmux session row when tmux is installed on PATH", async function () {
    const tmuxAvailable = await browser.execute(() => {
      try {
        const { spawnSync } = require("child_process");
        const res = spawnSync("which", ["tmux"]);
        return res.status === 0 && String(res.stdout ?? "").trim().length > 0;
      } catch {
        return false;
      }
    });
    if (!tmuxAvailable) {
      this.skip();
      return;
    }

    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    const hasNewTmuxRow = await $(".anvil-picker-new-tmux").isExisting();
    expect(hasNewTmuxRow).toBe(true);
  });

  // GREEN standing regression — catches FI-009 (setState-vs-onOpen
  // ordering meant `new-tmux` silently fell through to zsh). Dispatches
  // the choice programmatically via the plugin's openTerminalWithSpec,
  // then inspects the resulting TerminalView's backend opts to confirm
  // the right shell and shellArgs were threaded through.
  it("picker new-tmux choice dispatches a backend with tmux as the shell and new-session as the shellArg", async function () {
    const tmuxAvailable = await browser.execute(() => {
      try {
        const { spawnSync } = require("child_process");
        const res = spawnSync("which", ["tmux"]);
        return res.status === 0 && String(res.stdout ?? "").trim().length > 0;
      } catch {
        return false;
      }
    });
    if (!tmuxAvailable) {
      this.skip();
      return;
    }

    // Bypass the modal — go directly through the same endpoint the picker
    // would dispatch on a new-tmux choice. This is the contract we want
    // to pin, not the modal interaction.
    await browser.executeAsync((id: string, done: (v: unknown) => void) => {
      const app = (window as unknown as {
        app: {
          plugins: {
            plugins: Record<
              string,
              {
                openTerminalWithSpec: (spec: {
                  shell: string;
                  shellArgs?: string[];
                }) => Promise<void>;
              }
            >;
          };
        };
      }).app;
      const plugin = app.plugins.plugins[id];
      const { spawnSync } = require("child_process");
      const which = spawnSync("which", ["tmux"]);
      const tmuxPath = String(which.stdout ?? "").trim();
      void plugin
        .openTerminalWithSpec({ shell: tmuxPath, shellArgs: ["new-session"] })
        .then(() => done(null));
    }, PLUGIN_ID);

    await $(".obsidian-terminal-view .xterm").waitForExist({ timeout: 5000 });

    // Inspect the TerminalView's PtyBackend options. The backend field is
    // private on the view class but accessible at runtime.
    const backendOpts = await browser.execute((viewType: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(viewType);
      const view = leaves[0]?.view as unknown as {
        backend?: { opts?: { shell?: string; shellArgs?: string[] } };
      };
      return view?.backend?.opts ?? null;
    }, VIEW_TYPE);

    expect(backendOpts).not.toBeNull();
    expect(backendOpts?.shell ?? "").toMatch(/tmux$/);
    expect(backendOpts?.shellArgs ?? []).toEqual(["new-session"]);
  });

  it("Escape dismisses the picker without opening a terminal", async function () {
    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    await browser.execute(() => {
      const input = document.querySelector(
        ".modal-container .prompt input",
      ) as HTMLInputElement | null;
      input?.focus();
      const ev = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      });
      (input ?? document.activeElement ?? document.body).dispatchEvent(ev);
    });

    await browser.waitUntil(
      async () => {
        const els = await $$(".modal-container .prompt");
        const count = await els.length;
        return count === 0;
      },
      { timeout: 2000, timeoutMsg: "picker modal did not dismiss on Escape" },
    );

    const terminalMounted = await $(".obsidian-terminal-view .xterm").isExisting();
    expect(terminalMounted).toBe(false);
  });
});
