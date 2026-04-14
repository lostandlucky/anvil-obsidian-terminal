// Deliberately no `obsidian` import: this module is pure logic and must be
// unit-testable with fakes. Callers cast their leaves back to DockLeaf.
export type DockLeaf = unknown;

export interface DockRootSplit {
  direction?: string;
  children: unknown[];
  setDirection?: (direction: string) => void;
  containerEl?: {
    classList: {
      add: (cls: string) => void;
      remove: (cls: string) => void;
    };
  };
}

export interface DockWorkspace {
  createLeafInParent?: (parent: unknown, index: number) => DockLeaf;
  getLeaf: (
    newLeaf: "split",
    direction: "horizontal" | "vertical",
  ) => DockLeaf;
}

export interface BottomDockDeps {
  workspace: DockWorkspace;
  rootSplit: DockRootSplit;
}

export interface BottomDock {
  openLeaf(): DockLeaf;
  notifyLeafClosed(): void;
  readonly openLeafCount: number;
  readonly usingFallback: boolean;
}

export function createBottomDock(deps: BottomDockDeps): BottomDock {
  const { workspace, rootSplit } = deps;

  let openCount = 0;
  let originalDirection: string | null = null;
  let fallback = false;

  const hasCreateLeafInParent =
    typeof workspace.createLeafInParent === "function";

  const setSplitDirection = (direction: string) => {
    if (typeof rootSplit.setDirection === "function") {
      rootSplit.setDirection(direction);
      return;
    }
    rootSplit.direction = direction;
    const cls = rootSplit.containerEl?.classList;
    if (cls) {
      if (direction === "horizontal") {
        cls.remove("mod-vertical");
        cls.add("mod-horizontal");
      } else {
        cls.remove("mod-horizontal");
        cls.add("mod-vertical");
      }
    }
  };

  const openLeaf = (): DockLeaf => {
    if (!hasCreateLeafInParent) {
      fallback = true;
      openCount += 1;
      return workspace.getLeaf("split", "horizontal");
    }

    if (openCount === 0) {
      originalDirection = rootSplit.direction ?? null;
      setSplitDirection("horizontal");
    }

    const leaf = workspace.createLeafInParent!(
      rootSplit,
      rootSplit.children.length,
    );
    openCount += 1;
    return leaf;
  };

  const notifyLeafClosed = (): void => {
    if (openCount === 0) return;
    openCount -= 1;
    if (openCount > 0) return;

    if (fallback) {
      // Fallback mode never flipped rootSplit; nothing to restore.
      originalDirection = null;
      return;
    }

    if (originalDirection !== null) {
      setSplitDirection(originalDirection);
      originalDirection = null;
    }
  };

  return {
    openLeaf,
    notifyLeafClosed,
    get openLeafCount() {
      return openCount;
    },
    get usingFallback() {
      return fallback;
    },
  };
}
