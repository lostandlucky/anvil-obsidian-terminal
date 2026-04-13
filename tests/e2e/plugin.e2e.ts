import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "obsidian-terminal-plugin";
const COMMAND_ID = `${PLUGIN_ID}:open-terminal`;
const VIEW_TYPE = "obsidian-terminal-view";

type ObsidianWindow = Window & {
  app: {
    plugins: {
      plugins: Record<string, unknown>;
      enabledPlugins: Set<string>;
    };
    commands: {
      commands: Record<string, unknown>;
      executeCommandById: (id: string) => boolean;
    };
    workspace: {
      getLeavesOfType: (type: string) => Array<{ detach(): void }>;
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

async function openTerminal() {
  await browser.execute((id: string) => {
    const app = (window as unknown as ObsidianWindow).app;
    app.commands.executeCommandById(id);
  }, COMMAND_ID);
  await $(".obsidian-terminal-view .xterm").waitForExist({ timeout: 5000 });
}

async function readTerminalText(): Promise<string> {
  return browser.execute(() => {
    const rows = document.querySelector(
      ".obsidian-terminal-view .xterm-rows",
    );
    return rows ? (rows as HTMLElement).innerText : "";
  });
}

async function focusTerminal() {
  const textarea = await $(".obsidian-terminal-view .xterm-helper-textarea");
  await textarea.waitForExist({ timeout: 5000 });
  await browser.execute(() => {
    const ta = document.querySelector(
      ".obsidian-terminal-view .xterm-helper-textarea",
    ) as HTMLTextAreaElement | null;
    ta?.focus();
  });
}

describe("obsidian-terminal-plugin", function () {
  beforeEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  afterEach(async function () {
    await closeAllModals();
    await closeAllTerminalLeaves();
  });

  it("loads as an enabled plugin", async function () {
    const loaded = await browser.execute((id: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      return (
        Boolean(app.plugins.plugins[id]) && app.plugins.enabledPlugins.has(id)
      );
    }, PLUGIN_ID);
    expect(loaded).toBe(true);
  });

  it("registers the open-terminal command", async function () {
    const registered = await browser.execute((id: string) => {
      const app = (window as unknown as ObsidianWindow).app;
      return Boolean(app.commands.commands[id]);
    }, COMMAND_ID);
    expect(registered).toBe(true);
  });

  it("executing the command mounts xterm in an ItemView", async function () {
    await openTerminal();
    const exists = await $(".obsidian-terminal-view .xterm").isExisting();
    expect(exists).toBe(true);

    const hasScreen = await $(
      ".obsidian-terminal-view .xterm-screen",
    ).isExisting();
    expect(hasScreen).toBe(true);
  });

  it("shows the welcome message in the terminal buffer", async function () {
    await openTerminal();
    await browser.waitUntil(
      async () => (await readTerminalText()).includes("Obsidian Terminal"),
      { timeout: 5000, timeoutMsg: "welcome never rendered" },
    );
    const text = await readTerminalText();
    expect(text).toContain("Obsidian Terminal");
    expect(text).toContain("mock>");
  });

  it("typed input is echoed and the echo command prints its argument", async function () {
    await openTerminal();
    await focusTerminal();

    await browser.keys([
      "e",
      "c",
      "h",
      "o",
      " ",
      "h",
      "e",
      "l",
      "l",
      "o",
      "Enter",
    ]);

    await browser.waitUntil(
      async () => {
        const text = await readTerminalText();
        const afterPrompt = text.split("echo hello").slice(1).join("echo hello");
        return /\bhello\b/.test(afterPrompt);
      },
      { timeout: 5000, timeoutMsg: "echo output never rendered" },
    );
  });

  it("ANSI colors render as styled spans, not raw escape codes", async function () {
    await openTerminal();
    await focusTerminal();

    await browser.keys([
      "c",
      "o",
      "l",
      "o",
      "r",
      "s",
      "Enter",
    ]);

    await browser.waitUntil(
      async () => (await readTerminalText()).includes("bold-cyan"),
      { timeout: 5000, timeoutMsg: "colors output never rendered" },
    );

    const text = await readTerminalText();
    expect(text).not.toContain("\x1b[");
    expect(text).not.toMatch(/\[3\dm/);

    const styledSpans = await browser.execute(() => {
      const rows = document.querySelector(
        ".obsidian-terminal-view .xterm-rows",
      );
      if (!rows) return 0;
      const spans = rows.querySelectorAll("span");
      let styled = 0;
      for (const span of Array.from(spans)) {
        const cls = (span as HTMLElement).className || "";
        const style = (span as HTMLElement).getAttribute("style") || "";
        if (/xterm-fg-/.test(cls) || /color\s*:/.test(style)) styled++;
      }
      return styled;
    });
    expect(styledSpans).toBeGreaterThan(0);
  });

  it("Ctrl-C dispatched inside the focused terminal does NOT leak to Obsidian", async function () {
    await openTerminal();
    await focusTerminal();

    const leaked = await browser.execute(() => {
      let seen = false;
      const probe = (ev: KeyboardEvent) => {
        if (ev.ctrlKey && ev.key === "c") seen = true;
      };
      document.addEventListener("keydown", probe);
      try {
        const ta = document.querySelector(
          ".obsidian-terminal-view .xterm-helper-textarea",
        ) as HTMLElement | null;
        ta?.focus();
        const ev = new KeyboardEvent("keydown", {
          key: "c",
          code: "KeyC",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        ta?.dispatchEvent(ev);
        return seen;
      } finally {
        document.removeEventListener("keydown", probe);
      }
    });
    expect(leaked).toBe(false);
  });

  it("closing and reopening the terminal leaves no console errors", async function () {
    const before = await browser.getLogs("browser").catch(() => []);
    const baselineErrors = before.filter((e) =>
      /severe/i.test((e as { level?: string }).level ?? ""),
    ).length;

    await openTerminal();
    await closeAllTerminalLeaves();
    await openTerminal();

    const after = await browser.getLogs("browser").catch(() => []);
    const errors = after.filter((e) =>
      /severe/i.test((e as { level?: string }).level ?? ""),
    );
    expect(errors.length).toBeLessThanOrEqual(baselineErrors);
  });
});
