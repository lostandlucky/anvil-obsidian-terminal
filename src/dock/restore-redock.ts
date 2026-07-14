// BUG-001 restore-path redock: classify terminal leaves that Obsidian
// rehydrated from serialized layout state (app relaunch, workspaces-plugin
// changeLayout) as "strays" to be redocked, versus leaves the plugin placed
// itself this session, which are never touched.
//
// This predicate is the "restore vs deliberate user move" gate: in-window
// drags preserve leaf identity, so a leaf the plugin placed stays known even
// after the user moves it — the plugin never fights a deliberate move.
// Rehydration creates fresh leaf objects, which are unknown and get redocked.
//
// No `obsidian` import (testing-approach boundary rule) — the caller supplies
// the leaves, the main-window root, and the accessors.

export interface FindStrayOpts<L> {
  /** Current terminal-container leaves (from getLeavesOfType). */
  leaves: readonly L[];
  /** The main window's rootSplit. Nullish → classification is unsafe, no strays. */
  mainRoot: unknown;
  /** Resolve a leaf's root container (leaf.getRoot()). May throw on odd tree states. */
  getRoot: (leaf: L) => unknown;
  /** True if the plugin placed this exact leaf object this session. */
  isPluginPlaced: (leaf: L) => boolean;
}

/**
 * Return the leaves that should be redocked: not placed by the plugin this
 * session AND living in the main window root. Leaves in popouts/sidebars are
 * deliberate placements that survived serialization — left alone. A throwing
 * getRoot is treated as not-main (defensive on undocumented tree states).
 */
export function findStrayTerminalLeaves<L>(opts: FindStrayOpts<L>): L[] {
  const { leaves, mainRoot, getRoot, isPluginPlaced } = opts;
  if (mainRoot === null || mainRoot === undefined) return [];

  const strays: L[] = [];
  for (const leaf of leaves) {
    if (isPluginPlaced(leaf)) continue;
    let root: unknown;
    try {
      root = getRoot(leaf);
    } catch {
      continue;
    }
    if (root !== mainRoot) continue;
    strays.push(leaf);
  }
  return strays;
}
