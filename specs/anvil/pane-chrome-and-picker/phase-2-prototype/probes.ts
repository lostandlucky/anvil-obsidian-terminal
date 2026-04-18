// R8 probe scripts for the Phase 2 spike. NOT BUNDLED. These are intended to
// be copy-pasted into Obsidian's DevTools console (Ctrl-Shift-I) with the
// prototype plugin loaded, one probe at a time.
//
// Each probe prints a PASS / FAIL line. The criteria for pass/fail mirror
// tests/e2e/tab-isolation.e2e.ts:162–255. R8e is new (not in the e2e suite).
//
// Before running probes:
//   1. Load the prototype plugin (see README.md).
//   2. Cmd-P → "Anvil Prototype: Open terminal container".
//   3. Confirm at least one terminal tab is visible.
//
// Then paste one block at a time.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------
// Shared helpers. Paste this first.
// ------------------------------------------------------------
(() => {
  const w = window as any;
  w.__anvilProbe = {
    note: "probes-helpers-loaded",
    findContainer() {
      const leaves = w.app.workspace.getLeavesOfType("anvil-prototype-container-view");
      return leaves[0] ?? null;
    },
    xtermVisibleInContainer() {
      const el = document.querySelector(".anvil-proto-container .xterm") as HTMLElement | null;
      return Boolean(el && el.offsetParent !== null);
    },
    hasSiblingMarkdownInside() {
      const container = document.querySelector(".anvil-proto-container");
      if (!container) return false;
      return Boolean(container.querySelector(".markdown-source-view, .markdown-preview-view"));
    },
    async openNote(path: string, mode: false | "tab" | "split") {
      const base = path.replace(/\.md$/, "");
      await w.app.workspace.openLinkText(base, "", mode);
    },
    report(name: string, pass: boolean, detail?: string) {
      const line = `[R8] ${name}: ${pass ? "PASS" : "FAIL"}${detail ? " — " + detail : ""}`;
      // eslint-disable-next-line no-console
      console.log(line);
      return line;
    },
  };
  // eslint-disable-next-line no-console
  console.log("[R8] helpers loaded. Use window.__anvilProbe.");
})();

// ------------------------------------------------------------
// R8a — workspace.openLinkText(path, "", false) [default / replace-active mode]
// Expectation: note opens outside the container; container's xterm stays visible.
// ------------------------------------------------------------
(async () => {
  const w = window as any;
  const p = w.__anvilProbe;
  const notePath = "README.md"; // substitute a note that exists in your vault
  await p.openNote(notePath, false);
  await new Promise((r) => setTimeout(r, 300));
  const xtermOk = p.xtermVisibleInContainer();
  const noSiblingMarkdown = !p.hasSiblingMarkdownInside();
  const pass = xtermOk && noSiblingMarkdown;
  p.report("R8a openLinkText(false)", pass, `xtermVisible=${xtermOk}, noInsideMarkdown=${noSiblingMarkdown}`);
})();

// ------------------------------------------------------------
// R8b — workspace.openLinkText(path, "", "tab")  [Cmd-click equivalent]
// ------------------------------------------------------------
(async () => {
  const w = window as any;
  const p = w.__anvilProbe;
  const notePath = "README.md";
  await p.openNote(notePath, "tab");
  await new Promise((r) => setTimeout(r, 300));
  const xtermOk = p.xtermVisibleInContainer();
  const noSiblingMarkdown = !p.hasSiblingMarkdownInside();
  const pass = xtermOk && noSiblingMarkdown;
  p.report("R8b openLinkText(tab)", pass, `xtermVisible=${xtermOk}, noInsideMarkdown=${noSiblingMarkdown}`);
})();

// ------------------------------------------------------------
// R8c — workspace.openLinkText(path, "", "split")
// ------------------------------------------------------------
(async () => {
  const w = window as any;
  const p = w.__anvilProbe;
  const notePath = "README.md";
  await p.openNote(notePath, "split");
  await new Promise((r) => setTimeout(r, 300));
  const xtermOk = p.xtermVisibleInContainer();
  const noSiblingMarkdown = !p.hasSiblingMarkdownInside();
  const pass = xtermOk && noSiblingMarkdown;
  p.report("R8c openLinkText(split)", pass, `xtermVisible=${xtermOk}, noInsideMarkdown=${noSiblingMarkdown}`);
})();

// ------------------------------------------------------------
// R8d — synthetic HTML5 drag-drop onto the container content area
// ------------------------------------------------------------
(async () => {
  const w = window as any;
  const p = w.__anvilProbe;
  const notePath = "README.md";
  const container = document.querySelector(".anvil-proto-container") as HTMLElement | null;
  if (!container) {
    p.report("R8d synthetic drop", false, "no container in DOM");
    return;
  }
  const dt = new DataTransfer();
  dt.setData("text/plain", notePath);
  dt.setData("text/uri-list", `obsidian://open?file=${notePath}`);
  container.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  await new Promise((r) => setTimeout(r, 300));
  const xtermOk = p.xtermVisibleInContainer();
  const noSiblingMarkdown = !p.hasSiblingMarkdownInside();
  const pass = xtermOk && noSiblingMarkdown;
  p.report("R8d synthetic drop", pass, `xtermVisible=${xtermOk}, noInsideMarkdown=${noSiblingMarkdown}`);
})();

// ------------------------------------------------------------
// R8e — simulated third-party setViewState clobber
// Expectation: the call either is blocked, is reverted, or does not leave
// the container in a markdown-view state. The prototype relies on
// setPinned(true) + view.navigation = false; neither fully blocks an
// explicit setViewState, so the probe checks that the container was not
// silently replaced (i.e. the terminal leaf's view type is still
// "anvil-prototype-container-view" afterwards, or that the clobber is
// visible enough to recover from).
// ------------------------------------------------------------
(async () => {
  const w = window as any;
  const p = w.__anvilProbe;
  const leaf = p.findContainer();
  if (!leaf) {
    p.report("R8e third-party setViewState", false, "no container leaf");
    return;
  }
  try {
    await leaf.setViewState({ type: "markdown", state: { file: "README.md", mode: "source" } });
  } catch (err) {
    p.report("R8e third-party setViewState", true, `call threw: ${(err as Error).message}`);
    return;
  }
  await new Promise((r) => setTimeout(r, 300));
  const vt = leaf.getViewState?.()?.type ?? "(unknown)";
  const containerStillPresent = Boolean(document.querySelector(".anvil-proto-container .xterm"));
  // This probe is NOT expected to pass with the current mitigations — it
  // documents the residual risk. If it passes, note which mitigation resisted.
  const pass = vt === "anvil-prototype-container-view" && containerStillPresent;
  p.report(
    "R8e third-party setViewState",
    pass,
    `post-call leaf type=${vt}, containerPresent=${containerStillPresent}`,
  );
})();
