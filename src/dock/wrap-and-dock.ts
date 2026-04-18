// FI-012 wrap-and-dock: preserve existing rootSplit columns when opening the
// terminal container, instead of flipping rootSplit.direction blindly and
// flattening side-by-side notes into a row stack.
//
// Recipe is from specs/anvil/pane-chrome-and-picker/phase-3-fi-012-spike-findings.md
// (PROBE 11). No Obsidian import — callers cast their workspace/rootSplit.

export type WrapLeaf = {
  detach(): void;
  parent?: unknown;
};

export type WrapSplit = {
  direction?: string;
  children: unknown[];
  parent?: unknown;
  allowSingleChild?: boolean;
  insertChild?: (index: number, child: unknown) => void;
  removeChild?: (child: unknown) => void;
  setDirection?: (direction: string) => void;
};

export type WrapWorkspace = {
  createLeafBySplit?: (leaf: WrapLeaf, direction: string, before?: boolean) => WrapLeaf;
};

export interface WrapAndDockDeps {
  workspace: WrapWorkspace;
  rootSplit: WrapSplit;
}

export interface WrapHandle {
  wrapper: WrapSplit;
  originalDirection: string;
}

export interface WrapAndDock {
  openWithWrap(): WrapHandle | null;
  closeWithUnwrap(handle: WrapHandle | null): void;
  readonly available: boolean;
}

export function canWrap(deps: WrapAndDockDeps): boolean {
  const { workspace, rootSplit } = deps;
  return (
    typeof workspace.createLeafBySplit === "function" &&
    typeof rootSplit.insertChild === "function" &&
    typeof rootSplit.removeChild === "function" &&
    typeof rootSplit.setDirection === "function"
  );
}

function pickPivotLeaf(rootSplit: WrapSplit): WrapLeaf | null {
  for (const child of rootSplit.children) {
    const group = child as { children?: unknown[] };
    if (Array.isArray(group.children) && group.children.length > 0) {
      return group.children[0] as WrapLeaf;
    }
  }
  return null;
}

export function createWrapAndDock(deps: WrapAndDockDeps): WrapAndDock {
  const { workspace, rootSplit } = deps;
  const available = canWrap(deps);

  const openWithWrap = (): WrapHandle | null => {
    if (!available) return null;
    // Single child: nothing to preserve — caller uses the flat path.
    if (rootSplit.children.length < 2) return null;

    const originalDirection = rootSplit.direction ?? "vertical";
    const perpDir = originalDirection === "vertical" ? "horizontal" : "vertical";

    const pivotLeaf = pickPivotLeaf(rootSplit);
    if (!pivotLeaf) return null;

    const scratchLeaf = workspace.createLeafBySplit!(pivotLeaf, perpDir, false);
    const tabsOfPivot = (pivotLeaf as unknown as { parent: unknown }).parent;
    const wrapper = (tabsOfPivot as unknown as { parent: unknown }).parent as WrapSplit;

    // Reparent remaining rootSplit children INTO wrapper BEFORE detaching
    // scratch — keeps wrapper at >=2 children so it doesn't auto-collapse.
    try {
      const siblings = rootSplit.children.filter((c) => c !== wrapper);
      for (const sibling of siblings) {
        rootSplit.removeChild!(sibling);
        wrapper.insertChild!(wrapper.children.length, sibling);
      }

      scratchLeaf.detach();
      wrapper.setDirection!(originalDirection);
      rootSplit.setDirection!("horizontal");
      wrapper.allowSingleChild = true;

      return { wrapper, originalDirection };
    } catch {
      // Best-effort cleanup: unwind any partial wrap. Prevents a broken
      // wrapper from surviving a mid-flight throw.
      try {
        scratchLeaf.detach();
      } catch {
        /* already detached */
      }
      return null;
    }
  };

  const closeWithUnwrap = (handle: WrapHandle | null): void => {
    if (!handle) return;
    const { wrapper, originalDirection } = handle;

    try {
      wrapper.allowSingleChild = true;
      const kids = [...wrapper.children];
      for (const k of kids) {
        wrapper.removeChild!(k);
        rootSplit.insertChild!(rootSplit.children.length, k);
      }
    } finally {
      if (wrapper.parent === rootSplit) {
        try {
          rootSplit.removeChild!(wrapper);
        } catch {
          /* ignore — wrapper may have auto-collapsed */
        }
      }
      if (typeof rootSplit.setDirection === "function") {
        rootSplit.setDirection(originalDirection);
      }
    }
  };

  return {
    openWithWrap,
    closeWithUnwrap,
    get available() {
      return available;
    },
  };
}
