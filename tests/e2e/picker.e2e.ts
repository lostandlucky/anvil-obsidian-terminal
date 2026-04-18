import { browser, expect, $, $$ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const COMMAND_ID = `${PLUGIN_ID}:open-terminal`;
const VIEW_TYPE = "anvil-terminal-container-view";

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
    const terminalMounted = await $(".anvil-terminal-container-view .xterm").isExisting();
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

    await $(".anvil-terminal-container-view .xterm").waitForExist({ timeout: 5000 });

    // Inspect the active tab's PtyBackend options. opts is private on the
    // backend class but accessible at runtime.
    const backendOpts = await browser.execute((viewType: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      const leaves = app.workspace.getLeavesOfType(viewType);
      const view = leaves[0]?.view as unknown as {
        getActiveBackend?: () => { opts?: { shell?: string; shellArgs?: string[] } } | null;
      };
      return view?.getActiveBackend?.()?.opts ?? null;
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

    const terminalMounted = await $(".anvil-terminal-container-view .xterm").isExisting();
    expect(terminalMounted).toBe(false);
  });

  // --- Phase 1 (FI-010 Option B) additions: section labels are decorated DOM
  // siblings of the suggestion list, NOT entries in it. -----------------------

  // AC1 — structural: a header element is never also a .suggestion-item.
  it("no .anvil-picker-header element is also a .suggestion-item (structural)", async function () {
    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    const overlap = await browser.execute(() => {
      const headers = Array.from(
        document.querySelectorAll(".anvil-picker-header"),
      );
      return headers.filter((h) => h.classList.contains("suggestion-item")).length;
    });
    expect(overlap).toBe(0);
  });

  // AC2 — ArrowDown only ever lands on a selectable row.
  it("ArrowDown navigation visits only selectable rows, never a header", async function () {
    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    const selectableCount = await $$(".suggestion-item.anvil-picker-item").length;
    expect(selectableCount).toBeGreaterThan(0);

    const visitedClasses: string[] = [];
    for (let i = 0; i < selectableCount + 2; i += 1) {
      // record current selection class set
      const selectedClasses = await browser.execute(() => {
        const sel = document.querySelector(".suggestion-item.is-selected");
        return sel ? Array.from(sel.classList) : [];
      });
      visitedClasses.push(JSON.stringify(selectedClasses));

      await browser.execute(() => {
        const input = document.querySelector(
          ".modal-container .prompt input",
        ) as HTMLInputElement | null;
        input?.focus();
        const ev = new KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          keyCode: 40,
          which: 40,
          bubbles: true,
          cancelable: true,
        });
        (input ?? document.activeElement ?? document.body).dispatchEvent(ev);
      });
    }

    // Every recorded selection (including the initial one) must be a
    // selectable row class — never the header class. .suggestion-item is
    // implied by the selector.
    for (const classesJson of visitedClasses) {
      const classes: string[] = JSON.parse(classesJson);
      expect(classes).not.toContain("anvil-picker-header");
      // It must carry one of the selectable row classes. (When the modal is
      // first opened with no default-shell pre-select the initial selection
      // can be empty — in that case `classes` is [] and the loop below skips.)
      if (classes.length > 0) {
        const isSelectable =
          classes.includes("anvil-picker-shell") ||
          classes.includes("anvil-picker-new-tmux") ||
          classes.includes("anvil-picker-tmux-session");
        expect(isSelectable).toBe(true);
      }
    }
  });

  // AC2-reverse — User Testing step 3: ArrowUp same property.
  it("ArrowUp navigation visits only selectable rows, never a header", async function () {
    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    const selectableCount = await $$(".suggestion-item.anvil-picker-item").length;
    expect(selectableCount).toBeGreaterThan(0);

    for (let i = 0; i < selectableCount + 2; i += 1) {
      const cls = await browser.execute(() => {
        const sel = document.querySelector(".suggestion-item.is-selected");
        return sel ? Array.from(sel.classList) : [];
      });
      expect(cls).not.toContain("anvil-picker-header");

      await browser.execute(() => {
        const input = document.querySelector(
          ".modal-container .prompt input",
        ) as HTMLInputElement | null;
        input?.focus();
        const ev = new KeyboardEvent("keydown", {
          key: "ArrowUp",
          code: "ArrowUp",
          keyCode: 38,
          which: 38,
          bubbles: true,
          cancelable: true,
        });
        (input ?? document.activeElement ?? document.body).dispatchEvent(ev);
      });
    }
  });

  // AC3 — visual distinguishability: header computed style differs from a
  // shell row computed style on at least one of the listed properties.
  it("section header computed style differs from a shell row computed style", async function () {
    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    const diff = await browser.execute(() => {
      const header = document.querySelector(
        ".anvil-picker-header",
      ) as HTMLElement | null;
      const shell = document.querySelector(
        ".suggestion-item.anvil-picker-shell",
      ) as HTMLElement | null;
      if (!header || !shell) return { differs: false, reason: "missing element" };
      const h = getComputedStyle(header);
      const s = getComputedStyle(shell);
      const props = [
        "color",
        "fontWeight",
        "fontSize",
        "textTransform",
        "opacity",
        "backgroundColor",
      ] as const;
      const differing = props.filter((p) => h[p] !== s[p]);
      return { differs: differing.length > 0, differing };
    });
    expect(diff.differs).toBe(true);
  });

  // AC4 — clicking a section header does not invoke onChoose, does not
  // close the modal, does not change selection.
  it("clicking on a section header is a no-op (modal stays open, no terminal launched)", async function () {
    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    const before = await browser.execute(() => {
      const sel = document.querySelector(".suggestion-item.is-selected");
      return sel ? sel.outerHTML : null;
    });

    await browser.execute(() => {
      const header = document.querySelector(
        ".anvil-picker-header",
      ) as HTMLElement | null;
      header?.click();
    });

    // Modal still open
    const stillOpen = await $(".modal-container .prompt").isExisting();
    expect(stillOpen).toBe(true);

    // No terminal mounted
    const terminalMounted = await $(".anvil-terminal-container-view .xterm").isExisting();
    expect(terminalMounted).toBe(false);

    // Selected row unchanged
    const after = await browser.execute(() => {
      const sel = document.querySelector(".suggestion-item.is-selected");
      return sel ? sel.outerHTML : null;
    });
    expect(after).toBe(before);
  });

  // AC5 — DOM order: header sits immediately before the first item of its
  // section.
  it("the Launch new header sits immediately before the first shell row in DOM order", async function () {
    await triggerOpenTerminal();
    const modal = await $(".modal-container .prompt");
    await modal.waitForExist({ timeout: 3000 });

    const result = await browser.execute(() => {
      const headers = Array.from(
        document.querySelectorAll(".anvil-picker-header"),
      );
      const launchHeader = headers.find((h) =>
        (h.textContent ?? "").includes("Launch new"),
      ) as HTMLElement | undefined;
      if (!launchHeader) return { ok: false, reason: "no launch header" };
      const next = launchHeader.nextElementSibling as HTMLElement | null;
      return {
        ok: next?.classList.contains("anvil-picker-shell") ?? false,
        nextClasses: next ? Array.from(next.classList) : [],
      };
    });
    expect(result.ok).toBe(true);
  });

  // AC6 — section-aware filter hides empty sections. Type a query that
  // matches at least one shell but no tmux session names. Skip if tmux
  // isn't available so the assertion has something to hide.
  it("a query matching shells but no tmux sessions hides the tmux header", async function () {
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

    // Type a query that almost certainly matches no tmux session names but
    // does match shells. "zsh" works on the dev host; alternatively "bash"
    // would work too.
    await browser.execute(() => {
      const input = document.querySelector(
        ".modal-container .prompt input",
      ) as HTMLInputElement | null;
      if (!input) return;
      input.focus();
      input.value = "zsh";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Allow re-render to settle
    await browser.waitUntil(
      async () => {
        const headers = await browser.execute(() => {
          return Array.from(
            document.querySelectorAll(".anvil-picker-header"),
          ).map((h) => h.textContent ?? "");
        });
        return (
          headers.some((t) => t.includes("Launch new")) &&
          !headers.some((t) => t.includes("Attach to tmux session"))
        );
      },
      { timeout: 2000, timeoutMsg: "tmux header did not disappear after filter" },
    );

    const headers = await browser.execute(() => {
      return Array.from(
        document.querySelectorAll(".anvil-picker-header"),
      ).map((h) => h.textContent ?? "");
    });
    expect(headers.some((t) => t.includes("Launch new"))).toBe(true);
    expect(headers.some((t) => t.includes("Attach to tmux session"))).toBe(false);
  });

  // AC9 graceful-degrade is verified two ways: a unit-level source assertion
  // in profile-picker-r7.test.ts (try/catch wraps injection); and every other
  // test in this suite — they all open the picker via the same updateSuggestions
  // hook and would fail if injection threw uncaught.
});
