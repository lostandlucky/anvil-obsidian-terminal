import { describe, it, expect } from "vitest";
import { findStrayTerminalLeaves } from "./restore-redock";

// BUG-001 restore-path redock — stray classification.
//
// A "stray" is a terminal leaf that Obsidian rehydrated from serialized
// layout state (app relaunch, workspaces switch via changeLayout) rather
// than one the plugin placed itself this session. Strays get redocked;
// everything else is left alone — this predicate IS the "restore vs
// deliberate user move" gate (in-window drags preserve leaf identity, so
// a user-moved leaf stays plugin-placed and is never fought).

type FakeLeaf = { name: string };

const mainRoot = { kind: "rootSplit" };
const popoutRoot = { kind: "floating" };

function classify(opts: {
  leaves: FakeLeaf[];
  placed?: FakeLeaf[];
  roots?: Map<FakeLeaf, unknown>;
  getRoot?: (leaf: FakeLeaf) => unknown;
}): FakeLeaf[] {
  const placed = new Set(opts.placed ?? []);
  return findStrayTerminalLeaves<FakeLeaf>({
    leaves: opts.leaves,
    mainRoot,
    getRoot: opts.getRoot ?? ((leaf) => opts.roots?.get(leaf) ?? mainRoot),
    isPluginPlaced: (leaf) => placed.has(leaf),
  });
}

describe("findStrayTerminalLeaves (BUG-001)", () => {
  it("returns rehydrated main-window leaves the plugin did not place", () => {
    const restored = { name: "restored" };
    expect(classify({ leaves: [restored] })).toEqual([restored]);
  });

  it("excludes plugin-placed leaves — a user-moved docked leaf is never a stray", () => {
    const docked = { name: "docked" };
    expect(classify({ leaves: [docked], placed: [docked] })).toEqual([]);
  });

  it("excludes leaves living outside the main window root (popout/sidebar)", () => {
    const inPopout = { name: "popout" };
    expect(
      classify({
        leaves: [inPopout],
        roots: new Map([[inPopout, popoutRoot]]),
      }),
    ).toEqual([]);
  });

  it("partitions a mixed set: only unknown main-root leaves come back", () => {
    const placedLeaf = { name: "placed" };
    const strayLeaf = { name: "stray" };
    const popoutLeaf = { name: "popout" };
    expect(
      classify({
        leaves: [placedLeaf, strayLeaf, popoutLeaf],
        placed: [placedLeaf],
        roots: new Map<FakeLeaf, unknown>([
          [placedLeaf, mainRoot],
          [strayLeaf, mainRoot],
          [popoutLeaf, popoutRoot],
        ]),
      }),
    ).toEqual([strayLeaf]);
  });

  it("returns nothing for no leaves", () => {
    expect(classify({ leaves: [] })).toEqual([]);
  });

  it("treats a throwing getRoot as not-main (defensive on undocumented tree states)", () => {
    const weird = { name: "weird" };
    expect(
      classify({
        leaves: [weird],
        getRoot: () => {
          throw new Error("detached node");
        },
      }),
    ).toEqual([]);
  });

  it("returns nothing when the main root is unavailable — cannot classify safely", () => {
    const leaf = { name: "leaf" };
    expect(
      findStrayTerminalLeaves<FakeLeaf>({
        leaves: [leaf],
        mainRoot: null,
        getRoot: () => mainRoot,
        isPluginPlaced: () => false,
      }),
    ).toEqual([]);
  });
});
