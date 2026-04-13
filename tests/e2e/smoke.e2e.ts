import { browser, expect } from "@wdio/globals";

describe("wdio-obsidian-service smoke test", function () {
  it("launches Obsidian and loads the workspace", async function () {
    const workspaceReady = await browser.execute(() => {
      const app = (window as unknown as { app?: { workspace?: unknown } }).app;
      return Boolean(app?.workspace);
    });
    expect(workspaceReady).toBe(true);
  });
});
