import { describe, it, expect, vi } from "vitest";
import { createBottomDock } from "./bottom-dock";

type FakeLeaf = { id: string; detach?: () => void };

function makeDeps(options: {
  direction?: string;
  setDirection?: boolean;
  createLeafInParent?: boolean;
  childrenLength?: number;
} = {}) {
  const {
    direction = "vertical",
    setDirection = true,
    createLeafInParent = true,
    childrenLength = 2,
  } = options;

  const rootSplit: {
    direction: string;
    children: unknown[];
    setDirection?: (dir: string) => void;
    containerEl: HTMLElement;
  } = {
    direction,
    children: new Array(childrenLength).fill(null).map((_, i) => ({ i })),
    containerEl: {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    } as unknown as HTMLElement,
  };

  if (setDirection) {
    rootSplit.setDirection = vi.fn((dir: string) => {
      rootSplit.direction = dir;
    });
  }

  const createdLeaves: FakeLeaf[] = [];
  const splitLeaves: FakeLeaf[] = [];

  const workspace: {
    createLeafInParent?: (parent: unknown, idx: number) => FakeLeaf;
    getLeaf: (newLeaf: "split", dir: "horizontal" | "vertical") => FakeLeaf;
  } = {
    getLeaf: vi.fn((_newLeaf: "split", _dir: "horizontal" | "vertical") => {
      const leaf = { id: `split-${splitLeaves.length}` };
      splitLeaves.push(leaf);
      return leaf;
    }),
  };

  if (createLeafInParent) {
    workspace.createLeafInParent = vi.fn(
      (_parent: unknown, _idx: number) => {
        const leaf = { id: `child-${createdLeaves.length}` };
        createdLeaves.push(leaf);
        return leaf;
      },
    );
  }

  return { rootSplit, workspace, createdLeaves, splitLeaves };
}

describe("createBottomDock", () => {
  it("first openLeaf saves original direction and flips rootSplit to horizontal", () => {
    const { rootSplit, workspace } = makeDeps({ direction: "vertical" });
    const dock = createBottomDock({ workspace, rootSplit });

    dock.openLeaf();

    expect(rootSplit.setDirection).toHaveBeenCalledWith("horizontal");
    expect(rootSplit.direction).toBe("horizontal");
  });

  it("uses workspace.createLeafInParent with children.length as index when available", () => {
    const { rootSplit, workspace, createdLeaves } = makeDeps({
      childrenLength: 3,
    });
    const dock = createBottomDock({ workspace, rootSplit });

    const leaf = dock.openLeaf();

    expect(workspace.createLeafInParent).toHaveBeenCalledWith(rootSplit, 3);
    expect(createdLeaves).toContain(leaf);
    expect(dock.usingFallback).toBe(false);
  });

  it("when setDirection is missing, assigns rootSplit.direction directly", () => {
    const { rootSplit, workspace } = makeDeps({
      setDirection: false,
      direction: "vertical",
    });
    const dock = createBottomDock({ workspace, rootSplit });

    dock.openLeaf();

    expect(rootSplit.direction).toBe("horizontal");
  });

  it("falls back to workspace.getLeaf('split','horizontal') when createLeafInParent is missing", () => {
    const { rootSplit, workspace, splitLeaves } = makeDeps({
      createLeafInParent: false,
    });
    const dock = createBottomDock({ workspace, rootSplit });

    const leaf = dock.openLeaf();

    expect(workspace.getLeaf).toHaveBeenCalledWith("split", "horizontal");
    expect(splitLeaves).toContain(leaf);
    expect(dock.usingFallback).toBe(true);
  });

  it("second openLeaf does not overwrite the saved original direction", () => {
    const { rootSplit, workspace } = makeDeps({ direction: "vertical" });
    const dock = createBottomDock({ workspace, rootSplit });

    dock.openLeaf();
    // Something external mutates direction (shouldn't happen, but prove we don't re-capture)
    rootSplit.direction = "horizontal";
    dock.openLeaf();
    dock.notifyLeafClosed();
    dock.notifyLeafClosed();

    expect(rootSplit.direction).toBe("vertical");
  });

  it("notifyLeafClosed with multiple open leaves does not restore direction", () => {
    const { rootSplit, workspace } = makeDeps({ direction: "vertical" });
    const dock = createBottomDock({ workspace, rootSplit });

    dock.openLeaf();
    dock.openLeaf();
    dock.notifyLeafClosed();

    expect(rootSplit.direction).toBe("horizontal");
  });

  it("notifyLeafClosed on the last open leaf restores original direction via setDirection", () => {
    const { rootSplit, workspace } = makeDeps({ direction: "vertical" });
    const dock = createBottomDock({ workspace, rootSplit });

    dock.openLeaf();
    dock.notifyLeafClosed();

    expect(rootSplit.setDirection).toHaveBeenLastCalledWith("vertical");
    expect(rootSplit.direction).toBe("vertical");
    expect(dock.openLeafCount).toBe(0);
  });

  it("restore uses direct assignment when setDirection is missing", () => {
    const { rootSplit, workspace } = makeDeps({
      setDirection: false,
      direction: "vertical",
    });
    const dock = createBottomDock({ workspace, rootSplit });

    dock.openLeaf();
    dock.notifyLeafClosed();

    expect(rootSplit.direction).toBe("vertical");
  });

  it("in fallback mode, restore does not touch direction", () => {
    const { rootSplit, workspace } = makeDeps({
      createLeafInParent: false,
      direction: "vertical",
    });
    const dock = createBottomDock({ workspace, rootSplit });

    dock.openLeaf();
    // rootSplit.direction was never flipped in fallback mode
    expect(rootSplit.direction).toBe("vertical");

    dock.notifyLeafClosed();
    expect(rootSplit.direction).toBe("vertical");
    // setDirection was never called
    expect(rootSplit.setDirection).not.toHaveBeenCalled();
  });

  it("notifyLeafClosed is a no-op when count is already zero", () => {
    const { rootSplit, workspace } = makeDeps({ direction: "vertical" });
    const dock = createBottomDock({ workspace, rootSplit });

    expect(() => dock.notifyLeafClosed()).not.toThrow();
    expect(dock.openLeafCount).toBe(0);
    expect(rootSplit.setDirection).not.toHaveBeenCalled();
  });
});
