// Phase 2 spike prototype plugin entry. Registers a single view type that
// multiplexes N xterm instances inside one ItemView leaf.

import { Plugin, WorkspaceLeaf } from "obsidian";
import { PrototypeContainerView, PROTO_VIEW_TYPE } from "./container-view";

// Undocumented workspace surfaces we depend on for direct-rootSplit placement.
// Feature-detected per the pattern at src/dock/bottom-dock.ts:44–63.
type RootSplitLike = {
  direction?: string;
  children: unknown[];
  setDirection?: (direction: string) => void;
};
type WorkspaceWithInternal = {
  rootSplit: RootSplitLike;
  createLeafInParent?: (parent: unknown, index: number) => WorkspaceLeaf;
};

export default class PrototypePlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(
      PROTO_VIEW_TYPE,
      (leaf) => new PrototypeContainerView(leaf),
    );

    this.addCommand({
      id: "anvil-proto-open-container",
      name: "Anvil Prototype: Open terminal container",
      callback: () => void this.openContainer(),
    });

    this.addCommand({
      id: "anvil-proto-add-tab",
      name: "Anvil Prototype: Add terminal tab to active container",
      callback: () => {
        const leaf = this.app.workspace
          .getLeavesOfType(PROTO_VIEW_TYPE)
          .find((l) => l.view instanceof PrototypeContainerView);
        if (leaf && leaf.view instanceof PrototypeContainerView) {
          void leaf.view.addTab();
        }
      },
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(PROTO_VIEW_TYPE);
  }

  async openContainer(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PROTO_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    // Place the container as a DIRECT child of rootSplit — not inside a
    // WorkspaceTabs wrapper. This is what mirrors the main plugin's
    // src/dock/bottom-dock.ts pattern and what gives us R8b isolation:
    // with no tab-group wrapper above our leaf, openLinkText("tab") has
    // no adjacent slot to drop a sibling note into.
    //
    // Fall back to getLeaf("split") if createLeafInParent is not available
    // (older Obsidian versions — the prototype targets 1.12.7 where it is).
    const workspace = this.app.workspace as unknown as WorkspaceWithInternal;
    let leaf: WorkspaceLeaf;
    if (typeof workspace.createLeafInParent === "function") {
      const rootSplit = workspace.rootSplit;
      // Flip rootSplit to horizontal so the container lands below existing
      // children, not beside them. Mirrors BottomDock.openLeaf.
      if (typeof rootSplit.setDirection === "function") {
        rootSplit.setDirection("horizontal");
      } else {
        rootSplit.direction = "horizontal";
      }
      leaf = workspace.createLeafInParent(rootSplit, rootSplit.children.length);
    } else {
      leaf = this.app.workspace.getLeaf("split", "horizontal");
    }
    await leaf.setViewState({ type: PROTO_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
