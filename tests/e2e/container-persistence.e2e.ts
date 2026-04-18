// Phase 3 — AC8: layout save/restore of N tabs in-order with correct shells.
//
// RED expectation: the container view class does not yet implement
// getState()/setState() returning { tabs: Array<{shell, cwd, shellArgs}> },
// so a workspace reload will not restore the N tabs.

import { browser, expect } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const CONTAINER_VIEW_TYPE = "anvil-terminal-container-view";

type Spec = { shell: string; shellArgs?: string[]; cwd?: string };

type AnvilPluginLike = {
  openTerminalWithSpec: (spec: Spec) => Promise<void>;
};

type Ws = Window & {
  app: {
    plugins: { plugins: Record<string, AnvilPluginLike> };
    workspace: {
      getLeavesOfType: (t: string) => Array<{
        view: unknown;
        detach(): void;
      }>;
      detachLeavesOfType: (t: string) => void;
      getLayout: () => Record<string, unknown>;
      changeLayout: (layout: Record<string, unknown>) => Promise<void>;
      trigger?: (n: string) => void;
    };
  };
};

type ContainerView = {
  getTabIds?(): string[];
  getTabSpecs?(): Spec[];
};

async function closeContainer() {
  await browser.execute((t: string) => {
    const app = (window as unknown as Ws).app;
    app.workspace.detachLeavesOfType(t);
    app.workspace.trigger?.("layout-change");
  }, CONTAINER_VIEW_TYPE);
}

describe("container view — layout persistence (AC8)", function () {
  beforeEach(async function () {
    await closeContainer();
  });
  afterEach(async function () {
    await closeContainer();
  });

  it("AC8 — workspace reload restores N tabs in the same order with the same shells", async function () {
    const shells: Spec[] = [
      { shell: "/bin/zsh" },
      { shell: "/bin/bash", shellArgs: ["-l"] },
      { shell: "/bin/zsh", cwd: "/tmp" },
    ];

    // Open 3 tabs with distinct specs
    for (const spec of shells) {
      await browser.executeAsync(
        (id: string, s: Spec, done: (v: unknown) => void) => {
          const app = (window as unknown as Ws).app;
          void app.plugins.plugins[id]
            .openTerminalWithSpec(s)
            .then(() => done(null));
        },
        PLUGIN_ID,
        spec,
      );
    }

    // Capture the layout JSON and verify the in-memory tab order first
    const preReloadSpecs = await browser.execute((t: string) => {
      const app = (window as unknown as Ws).app;
      const view = app.workspace.getLeavesOfType(t)[0]?.view as unknown as ContainerView;
      return view.getTabSpecs?.() ?? [];
    }, CONTAINER_VIEW_TYPE);
    expect(preReloadSpecs.length).toBe(3);

    // Save the workspace layout, then re-apply it to force a restore cycle.
    // (In a real session the user reloads via Ctrl-R; we round-trip the layout
    // JSON here to exercise the same setState()/getState() contract.)
    const layout = await browser.execute(() => {
      return (window as unknown as Ws).app.workspace.getLayout();
    });

    // Detach the container, then reapply the layout to force Obsidian to
    // reconstruct the view and call setState with our saved { tabs: [...] }.
    await closeContainer();

    await browser.executeAsync(
      (l: Record<string, unknown>, done: (v: unknown) => void) => {
        const app = (window as unknown as Ws).app;
        void app.workspace.changeLayout(l).then(() => done(null));
      },
      layout as Record<string, unknown>,
    );

    // After restore, the container should reappear with 3 tabs in the same order.
    const restoredSpecs = await browser.execute((t: string) => {
      const app = (window as unknown as Ws).app;
      const leaves = app.workspace.getLeavesOfType(t);
      const view = leaves[0]?.view as unknown as ContainerView;
      return view?.getTabSpecs?.() ?? [];
    }, CONTAINER_VIEW_TYPE);

    expect(restoredSpecs.length).toBe(3);
    expect(restoredSpecs[0].shell).toBe(shells[0].shell);
    expect(restoredSpecs[1].shell).toBe(shells[1].shell);
    expect(restoredSpecs[1].shellArgs).toEqual(shells[1].shellArgs);
    expect(restoredSpecs[2].shell).toBe(shells[2].shell);
    expect(restoredSpecs[2].cwd).toBe(shells[2].cwd);
  });
});
