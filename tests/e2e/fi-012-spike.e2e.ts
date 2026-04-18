// FI-012 API-investigation spike — THROWAWAY, delete after Phase 3 spike closes.
//
// PROBE 10 (clean): refined hijack recipe against isolated workspace state.
// Prior probes (in git history of this file) established:
//   - WorkspaceSplit internals (insertChild/removeChild/replaceChild on proto)
//   - `new WorkspaceSplitClass(workspace)` constructs an object missing containerEl
//     (1-arg construct insufficient — DOM wiring is lazy/external)
//   - createLeafBySplit(leaf, perpendicularDir) wraps that leaf's tabgroup in
//     a fully-wired WorkspaceSplit — Obsidian builds the containerEl for us
//   - detaching the scratch leaf collapses a 1-child wrapper: wrapper orphans
//
// The refined recipe tested here: reparent siblings INTO the wrapper BEFORE
// detaching the scratch leaf, so the wrapper never hits 1-child state.

import { browser, expect } from "@wdio/globals";

type LeafLike = {
  detach(): void;
  setViewState(s: unknown): Promise<void>;
  parent?: unknown;
};

type Ws = Window & {
  app: {
    workspace: {
      rootSplit: unknown;
      activeLeaf: LeafLike | null;
      getLeaf: (...a: unknown[]) => LeafLike;
      createLeafInParent?: (p: unknown, i: number) => LeafLike;
      createLeafBySplit?: (l: LeafLike, dir?: string, before?: boolean) => LeafLike;
      getLeavesOfType: (t: string) => LeafLike[];
      setActiveLeaf: (l: LeafLike, opts?: unknown) => void;
      detachLeavesOfType: (t: string) => void;
      getLayout: () => Record<string, unknown>;
    };
    vault: {
      create: (p: string, c: string) => Promise<unknown>;
      delete: (f: unknown) => Promise<void>;
      getAbstractFileByPath: (p: string) => unknown;
    };
  };
};

const NOTE_A = "fi012-a.md";
const NOTE_B = "fi012-b.md";

async function resetWorkspace() {
  await browser.executeAsync((done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    // Detach everything except an empty placeholder
    for (const t of ["markdown", "empty", "obsidian-terminal-view"]) {
      try { app.workspace.detachLeavesOfType(t); } catch { /* */ }
    }
    // Wait a tick, then ensure rootSplit has at least one leaf
    setTimeout(() => done(null), 100);
  });
}

async function ensureNotes() {
  await browser.executeAsync((a: string, b: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    const ensure = async (p: string) => {
      if (!app.vault.getAbstractFileByPath(p)) {
        await app.vault.create(p, `# ${p}\n`);
      }
    };
    void Promise.all([ensure(a), ensure(b)]).then(() => done(null));
  }, NOTE_A, NOTE_B);
}

async function deleteNotes() {
  await browser.executeAsync((a: string, b: string, done: (v: unknown) => void) => {
    const app = (window as unknown as Ws).app;
    const drop = async (p: string) => {
      const f = app.vault.getAbstractFileByPath(p);
      if (f) await app.vault.delete(f);
    };
    void Promise.all([drop(a), drop(b)]).then(() => done(null));
  }, NOTE_A, NOTE_B);
}

describe("FI-012 API-investigation spike (refined)", function () {
  before(async function () {
    await ensureNotes();
  });

  after(async function () {
    await resetWorkspace();
    await deleteNotes();
  });

  beforeEach(async function () {
    await resetWorkspace();
  });

  it("PROBE 11 — final recipe with correct reverse + single-child case + layout restore", async function () {
    const result = await browser.executeAsync(
      (noteA: string, noteB: string, done: (v: unknown) => void) => {
        const app = (window as unknown as Ws).app;

        type SplitLike = {
          direction?: string;
          children: unknown[];
          parent?: unknown;
          allowSingleChild?: boolean;
          insertChild?: (idx: number, c: unknown) => void;
          removeChild?: (c: unknown) => void;
          setDirection?: (d: string) => void;
          containerEl?: HTMLElement;
        };

        const rs = app.workspace.rootSplit as unknown as SplitLike;

        const snapTree = (label: string) => {
          const rec = (node: SplitLike, depth = 0): unknown => {
            return {
              ctor: Object.getPrototypeOf(node)?.constructor?.name ?? "?",
              direction: node.direction,
              childCount: Array.isArray(node.children) ? node.children.length : 0,
              children: depth < 3 && Array.isArray(node.children)
                ? node.children.map((c) => rec(c as SplitLike, depth + 1))
                : undefined,
            };
          };
          return { label, tree: rec(rs) };
        };

        const steps: unknown[] = [];

        type WrapHandle = {
          wrapper: SplitLike;
          originalDirection: string;
        } | null;

        // ==== RECIPE: open-with-wrap ====
        const openWithWrap = (): WrapHandle => {
          const originalDirection = rs.direction ?? "vertical";

          // Case 1: single child (nothing to wrap) — caller takes standard path
          if (rs.children.length < 2) return null;

          // Case 2: multi-child — hijack wrap
          const anyLeaf = app.workspace.getMostRecentLeaf?.();
          let pivotLeaf: LeafLike | null = null;
          // Find a leaf inside rootSplit to pivot on
          for (const c of rs.children) {
            const tabs = c as { children?: unknown[] };
            if (Array.isArray(tabs.children) && tabs.children.length > 0) {
              pivotLeaf = tabs.children[0] as LeafLike;
              break;
            }
          }
          if (!pivotLeaf && anyLeaf) pivotLeaf = anyLeaf as LeafLike;
          if (!pivotLeaf) throw new Error("no pivot leaf found");

          const perpDir = originalDirection === "vertical" ? "horizontal" : "vertical";
          const cbs = app.workspace.createLeafBySplit!;
          const scratchLeaf = cbs.call(app.workspace, pivotLeaf, perpDir, false);

          // Identify wrapper: pivotLeaf.parent.parent after the split is the new wrapper
          const tabsOfPivot = (pivotLeaf as unknown as { parent: unknown }).parent;
          const wrapper = (tabsOfPivot as unknown as { parent: unknown }).parent as SplitLike;

          // Reparent siblings INTO wrapper BEFORE detaching scratch
          const siblings = rs.children.filter((c) => c !== wrapper);
          for (const s of siblings) {
            rs.removeChild!(s);
            wrapper.insertChild!(wrapper.children.length, s);
          }

          // Detach scratch (wrapper has 2+ real children now → no collapse)
          (scratchLeaf as LeafLike).detach();

          // Flip wrapper back to original direction; rs to horizontal
          wrapper.setDirection!(originalDirection);
          rs.setDirection!("horizontal");

          // Belt-and-suspenders: set allowSingleChild so any stray single-child
          // state during close doesn't collapse unexpectedly.
          wrapper.allowSingleChild = true;

          return { wrapper, originalDirection };
        };

        // ==== RECIPE: close-with-unwrap ====
        const closeWithUnwrap = (h: WrapHandle) => {
          if (!h) {
            // No wrap was done on open — nothing to unwrap.
            return;
          }
          const { wrapper, originalDirection } = h;
          // Remove wrapper's kids one by one and reinsert into rs.
          // allowSingleChild=true prevents collapse.
          const kids = [...wrapper.children];
          for (const k of kids) {
            wrapper.removeChild!(k);
            rs.insertChild!(rs.children.length, k);
          }
          // Wrapper is empty. removeChild's "0 === o.length" branch should
          // have auto-removed it on the last kid, but that only fires when
          // rs is `this.parent` during the removeChild call. Check + force.
          if (wrapper.parent === rs) {
            rs.removeChild!(wrapper);
          }
          rs.setDirection!(originalDirection);
        };

        (async () => {
          try {
            // === SCENARIO A: Multi-child (wrap needed) ===
            // Build side-by-side
            const leafA = app.workspace.getLeaf(false);
            await leafA.setViewState({
              type: "markdown",
              state: { file: noteA, mode: "source" },
            });
            app.workspace.setActiveLeaf(leafA, { focus: true });
            const cbs = app.workspace.createLeafBySplit!;
            const leafB = cbs.call(app.workspace, leafA, "vertical", false);
            await leafB.setViewState({
              type: "markdown",
              state: { file: noteB, mode: "source" },
            });
            steps.push(snapTree("A.built side-by-side"));

            // Open container with wrap
            const h = openWithWrap();
            // Dock a stand-in terminal leaf into rs
            const termLeaf = app.workspace.createLeafInParent!(
              rs as unknown as never,
              rs.children.length,
            );
            try { await termLeaf.setViewState({ type: "empty", state: {} }); } catch {}
            steps.push(snapTree("A.after open+dock"));

            // Serialize layout for the record
            const layout = app.workspace.getLayout();
            steps.push({
              label: "A.layout serialize",
              layoutMainStr: JSON.stringify(layout.main ?? layout).slice(0, 2000),
            });

            // Close: detach term, unwrap
            termLeaf.detach();
            closeWithUnwrap(h);
            steps.push(snapTree("A.after close+unwrap"));

            // Cleanup side-by-side
            try { leafB.detach(); } catch {}
          } catch (e) {
            steps.push({ scenario: "A", err: (e as Error).message });
          }

          // Reset before scenario B
          for (const t of ["markdown", "empty", "obsidian-terminal-view"]) {
            try { app.workspace.detachLeavesOfType(t); } catch {}
          }
          await new Promise((r) => setTimeout(r, 50));

          try {
            // === SCENARIO B: Single-child (no wrap needed) ===
            const onlyLeaf = app.workspace.getLeaf(false);
            await onlyLeaf.setViewState({
              type: "markdown",
              state: { file: noteA, mode: "source" },
            });
            app.workspace.setActiveLeaf(onlyLeaf, { focus: true });
            steps.push(snapTree("B.built single"));

            const h2 = openWithWrap(); // should return null
            const termLeaf2 = app.workspace.createLeafInParent!(
              rs as unknown as never,
              rs.children.length,
            );
            try { await termLeaf2.setViewState({ type: "empty", state: {} }); } catch {}
            // In single-child case, caller still needs to flip rs.direction
            // to horizontal. Reproduce the existing BottomDock behavior.
            if (!h2) {
              rs.setDirection!("horizontal");
            }
            steps.push({ ...snapTree("B.after open+dock"), handleNull: h2 === null });

            // Close
            termLeaf2.detach();
            closeWithUnwrap(h2);
            // caller restores direction in single-child case
            if (!h2) {
              // Original single-child direction was whatever baseline was (likely "vertical");
              // we'd capture it in a real impl. For the probe, just flip to vertical.
              rs.setDirection!("vertical");
            }
            steps.push(snapTree("B.after close"));
          } catch (e) {
            steps.push({ scenario: "B", err: (e as Error).message });
          }

          done({ ok: true, steps });
        })();
      },
      NOTE_A,
      NOTE_B,
    );

    // eslint-disable-next-line no-console
    console.log("[FI-012 PROBE 11] final recipe:\n", JSON.stringify(result, null, 2));
    expect(result).toBeDefined();
  });

  it("PROBE 10 — refined hijack recipe, isolated state, multi-child scenario", async function () {
    const result = await browser.executeAsync(
      (noteA: string, noteB: string, done: (v: unknown) => void) => {
        const app = (window as unknown as Ws).app;

        const rs = app.workspace.rootSplit as unknown as {
          direction?: string;
          children: unknown[];
          insertChild?: (c: unknown, idx?: number) => void;
          removeChild?: (c: unknown) => void;
          setDirection?: (d: string) => void;
        };

        const snapshot = (label: string) => {
          const kids = rs.children ?? [];
          return {
            label,
            direction: rs.direction,
            childCount: kids.length,
            childShapes: kids.map((c: unknown) => {
              const co = c as { direction?: string; children?: unknown[]; parent?: unknown };
              return {
                ctor: Object.getPrototypeOf(co)?.constructor?.name ?? "?",
                direction: co.direction,
                grandchildCount: Array.isArray(co.children) ? co.children.length : 0,
                parentIsRs: co.parent === rs,
              };
            }),
          };
        };

        const countMdDom = () =>
          document.querySelectorAll(
            ".workspace-leaf .markdown-source-view, .workspace-leaf .markdown-preview-view",
          ).length;

        const steps: unknown[] = [];

        (async () => {
          try {
            steps.push({ phase: "entry snapshot", snap: snapshot("entry") });

            // Build side-by-side
            const leafA = app.workspace.getLeaf(false);
            await leafA.setViewState({
              type: "markdown",
              state: { file: noteA, mode: "source" },
            });
            app.workspace.setActiveLeaf(leafA, { focus: true });
            steps.push({ phase: "after open A", snap: snapshot("A") });

            const cbs = app.workspace.createLeafBySplit;
            if (typeof cbs !== "function") {
              done({ err: "no createLeafBySplit" });
              return;
            }
            const leafB = cbs.call(app.workspace, leafA, "vertical", false);
            await leafB.setViewState({
              type: "markdown",
              state: { file: noteB, mode: "source" },
            });
            steps.push({
              phase: "after split B",
              snap: snapshot("B"),
              mdDom: countMdDom(),
            });

            if (rs.children.length < 2) {
              done({
                err: `side-by-side build failed — rs.children.length=${rs.children.length}`,
                steps,
              });
              return;
            }

            const originalDirection = rs.direction ?? "vertical";
            const perpDir = originalDirection === "vertical" ? "horizontal" : "vertical";

            // HIJACK
            const scratchLeaf = cbs.call(app.workspace, leafA, perpDir, false);
            const leafAParent = (leafA as unknown as { parent: unknown }).parent;
            const wrapper = (leafAParent as unknown as { parent: unknown }).parent as unknown as {
              direction?: string;
              children: unknown[];
              parent?: unknown;
              insertChild?: (c: unknown, idx?: number) => void;
              removeChild?: (c: unknown) => void;
              setDirection?: (d: string) => void;
              containerEl?: HTMLElement;
            };
            steps.push({
              phase: "after hijack",
              snap: snapshot("hijack"),
              wrapperCtor: Object.getPrototypeOf(wrapper)?.constructor?.name ?? "?",
              wrapperChildren: wrapper.children?.length,
              wrapperDirection: wrapper.direction,
              wrapperHasContainerEl: !!wrapper.containerEl,
              wrapperParentIsRs: wrapper.parent === rs,
              mdDom: countMdDom(),
            });

            // Reparent siblings into wrapper BEFORE detaching scratch
            const remaining = rs.children.filter((c) => c !== wrapper);
            for (const sibling of remaining) {
              const sib = sibling as { containerEl?: HTMLElement; parent?: unknown };
              const preRemove = {
                siblingHasContainerEl: !!sib.containerEl,
                siblingParent: sib.parent === rs ? "rs" : "?",
              };
              rs.removeChild!(sibling);
              const postRemove = {
                siblingHasContainerEl: !!sib.containerEl,
                siblingParentNow: sib.parent === rs ? "rs" : sib.parent === null ? "null" : "other",
                wrapperChildren: wrapper.children?.length,
                wrapperHasContainerEl: !!wrapper.containerEl,
              };
              steps.push({ phase: "before/after removeChild(sibling)", preRemove, postRemove });
              // Signature is insertChild(index, child) — NOT (child, index).
              // Source: function(e, t) { ...; a.splice(e, 0, t); ...t.containerEl... }
              // Use append index (wrapper.children.length) — insertChild clamps OOB to append.
              (wrapper.insertChild as unknown as (idx: number, child: unknown) => void)(
                wrapper.children.length,
                sibling,
              );
              steps.push({ phase: "insertChild(idx, child) — append: OK" });
            }
            steps.push({
              phase: "after reparent siblings (scratch still in wrapper)",
              snap: snapshot("rp"),
              wrapperChildren: wrapper.children?.length,
              mdDom: countMdDom(),
            });

            // Detach scratch — wrapper should keep >=2 kids now so no collapse
            scratchLeaf.detach();
            steps.push({
              phase: "after scratch detach",
              snap: snapshot("sc"),
              wrapperChildren: wrapper.children?.length,
              wrapperHasContainerEl: !!wrapper.containerEl,
              wrapperParentIsRs: wrapper.parent === rs,
              mdDom: countMdDom(),
            });

            // Flip directions
            wrapper.setDirection!(originalDirection);
            rs.setDirection!("horizontal");
            steps.push({
              phase: "after direction flips",
              snap: snapshot("flip"),
              wrapperDirection: wrapper.direction,
              rsDirection: rs.direction,
            });

            // Dock terminal stand-in
            const termLeaf = app.workspace.createLeafInParent!(
              rs as unknown as never,
              rs.children.length,
            );
            try {
              await termLeaf.setViewState({ type: "empty", state: {} });
            } catch { /* */ }
            steps.push({
              phase: "after dock",
              snap: snapshot("dock"),
              mdDom: countMdDom(),
            });

            // Layout serialize
            const layout = app.workspace.getLayout();
            steps.push({
              phase: "layout serialize",
              layoutMainStr: JSON.stringify(layout.main ?? layout).slice(0, 2000),
            });

            // === REVERSE ===
            termLeaf.detach();
            steps.push({
              phase: "after term detach",
              snap: snapshot("td"),
              wrapperChildren: wrapper.children?.length,
              wrapperParentIsRs: wrapper.parent === rs,
            });

            // Move wrapper's kids back to rs
            const wrapperKids = [...wrapper.children];
            for (const k of wrapperKids) {
              wrapper.removeChild!(k);
              (rs.insertChild as unknown as (idx: number, c: unknown) => void)(
                rs.children.length,
                k,
              );
            }
            steps.push({
              phase: "after moving kids back",
              snap: snapshot("back"),
              wrapperChildren: wrapper.children?.length,
              wrapperParentIsRs: wrapper.parent === rs,
            });

            // Remove wrapper if still attached
            if (wrapper.parent === rs) {
              try {
                rs.removeChild!(wrapper);
              } catch (e) {
                steps.push({ phase: `rs.removeChild(wrapper) threw: ${(e as Error).message}` });
              }
            }
            rs.setDirection!(originalDirection);
            steps.push({
              phase: "final",
              snap: snapshot("final"),
              mdDom: countMdDom(),
            });

            done({ ok: true, steps });
          } catch (e) {
            done({ err: (e as Error).message, steps });
          }
        })();
      },
      NOTE_A,
      NOTE_B,
    );

    // eslint-disable-next-line no-console
    console.log("[FI-012 PROBE 10] refined hijack:\n", JSON.stringify(result, null, 2));
    expect(result).toBeDefined();
  });
});
