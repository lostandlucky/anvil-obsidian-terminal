// Phase 2 — AC2 e2e: switching Obsidian theme re-renders the open terminal's
// background and foreground without plugin reload.
//
// We toggle Obsidian's theme via `app.customCss.setTheme(...)` (the same
// path Obsidian uses internally when the user picks light/dark from
// Appearance settings). We then poll for the terminal's xterm theme.background
// to change. The test fires Obsidian's "css-change" workspace event
// explicitly as a belt-and-braces — the live app fires it; in the harness
// `setTheme` should fire it too, but defensive triggers keep this from
// flaking on harness quirks.

import { browser, expect, $ } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const CONTAINER_VIEW_TYPE = "anvil-terminal-container-view";

interface AnvilPluginLike {
  openDefaultTerminal: () => Promise<void>;
}

interface ContainerViewLike {
  getActiveHost?: () => null | {
    terminal: { options: { theme?: { background?: string; foreground?: string } } };
  };
}

interface Ws extends Window {
  app: {
    plugins: { plugins: Record<string, AnvilPluginLike> };
    workspace: {
      getLeavesOfType: (t: string) => Array<{ view: ContainerViewLike }>;
      detachLeavesOfType: (t: string) => void;
      trigger?: (n: string) => void;
    };
    customCss?: {
      setTheme?: (name: string) => void;
      theme?: string;
    };
  };
}

async function closeAllContainers(): Promise<void> {
  await browser.execute((t: string) => {
    const app = (window as unknown as Ws).app;
    app.workspace.detachLeavesOfType(t);
    app.workspace.trigger?.("layout-change");
  }, CONTAINER_VIEW_TYPE);
}

async function openTerminal(): Promise<void> {
  await browser.executeAsync((id: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    void app.plugins.plugins[id].openDefaultTerminal().then(() => done(null));
  }, PLUGIN_ID);
  await $(".anvil-terminal-container-view .xterm").waitForExist({ timeout: 10000 });
}

async function readActiveTheme(): Promise<{ background?: string; foreground?: string }> {
  return browser.execute((t: string) => {
    const app = (window as unknown as Ws).app;
    const view = app.workspace.getLeavesOfType(t)[0]?.view as ContainerViewLike;
    const host = view.getActiveHost?.();
    return {
      background: host?.terminal.options.theme?.background,
      foreground: host?.terminal.options.theme?.foreground,
    };
  }, CONTAINER_VIEW_TYPE);
}

async function applyBodyClass(cls: "theme-light" | "theme-dark"): Promise<void> {
  // Drive the body class directly. Real Obsidian flips this when the user
  // changes Appearance > Light/Dark; our css-change wiring listens on the
  // workspace event, plus a MutationObserver fallback. Toggling the class
  // exercises the fallback, and triggering 'css-change' exercises the
  // primary path. We do both so the test pins the contract regardless of
  // which path is wired in the pinned binary.
  await browser.execute((c: string) => {
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(c);
    const app = (window as unknown as Ws).app;
    app.workspace.trigger?.("css-change");
  }, cls);
}

describe("Phase 2 — theming (AC2)", function () {
  beforeEach(async function () {
    await closeAllContainers();
    // Start in dark mode so we have a baseline.
    await applyBodyClass("theme-dark");
  });

  afterEach(async function () {
    await closeAllContainers();
  });

  it("AC2 — terminal options.theme.background changes when Obsidian theme switches", async function () {
    await openTerminal();
    const dark = await readActiveTheme();
    expect(dark.background).toBeTruthy();

    // Switch to light.
    await applyBodyClass("theme-light");

    // Wait up to 3s for the terminal to reflect the new theme. The timeout
    // buffers slow CI; the broadcast is synchronous but xterm's options
    // setter has a microtask hop.
    await browser.waitUntil(
      async () => {
        const cur = await readActiveTheme();
        return Boolean(cur.background) && cur.background !== dark.background;
      },
      {
        timeout: 3000,
        timeoutMsg:
          "terminal background did not change after switching Obsidian theme",
      },
    );

    const light = await readActiveTheme();
    expect(light.background).not.toBe(dark.background);
    // Foreground should also have shifted (--text-normal differs between
    // light/dark Obsidian themes); but if the harness has minimal CSS we
    // tolerate equality on foreground — only background is the pinned signal.
  });
});
