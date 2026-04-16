import { App, SuggestModal } from "obsidian";
import type { DiscoveredShell } from "../profiles/shell-discovery";
import type { TmuxDiscoveryResult } from "../profiles/tmux-discovery";
import {
  buildPickerSections,
  filterPickerSections,
  findDefaultShellFlatIndex,
  flattenSections,
  PickerItem,
  PickerSection,
  PickerSectionLabel,
} from "./picker-items";

export type ProfileChoice =
  | { kind: "shell"; path: string; name: string }
  | { kind: "new-tmux" }
  | { kind: "tmux-session"; name: string };

export interface ProfilePickerOptions {
  shells: DiscoveredShell[];
  tmux: TmuxDiscoveryResult;
  defaultShellPath: string | null;
  onChoose: (choice: ProfileChoice) => void;
}

interface ChooserHandle {
  setSelectedItem?: (index: number, evt?: Event) => void;
}

const HEADER_CLASS = "anvil-picker-header";

/**
 * Feature-detect: does Obsidian's SuggestModal expose `updateSuggestions`
 * as the post-rerender hook we override for section-label injection?
 * Detected once at module load — if Obsidian removes the method in a
 * future version, we silently fall back to no labels (R7 / AC9).
 */
const HAS_UPDATE_SUGGESTIONS_HOOK =
  typeof (SuggestModal.prototype as unknown as {
    updateSuggestions?: unknown;
  }).updateSuggestions === "function";

export class ProfilePickerModal extends SuggestModal<PickerItem> {
  private readonly sections: PickerSection[];
  private readonly onChooseProfile: (choice: ProfileChoice) => void;
  private lastSectionStartLabels: Map<number, PickerSectionLabel> = new Map();

  constructor(app: App, options: ProfilePickerOptions) {
    super(app);
    this.sections = buildPickerSections({
      shells: options.shells,
      tmux: options.tmux,
      defaultShellPath: options.defaultShellPath,
    });
    this.onChooseProfile = options.onChoose;
    this.setPlaceholder("Choose a shell or tmux session…");
    this.limit = 500;
  }

  getSuggestions(query: string): PickerItem[] {
    const filtered = filterPickerSections(this.sections, query);
    const { items, sectionStartLabels } = flattenSections(filtered);
    this.lastSectionStartLabels = sectionStartLabels;
    return items;
  }

  onOpen(): void {
    super.onOpen();
    const defaultIndex = findDefaultShellFlatIndex(this.sections);
    if (defaultIndex < 0) return;
    const chooser = (this as unknown as { chooser?: ChooserHandle }).chooser;
    chooser?.setSelectedItem?.(defaultIndex);
  }

  renderSuggestion(item: PickerItem, el: HTMLElement): void {
    el.addClass("anvil-picker-item");
    switch (item.kind) {
      case "shell": {
        el.addClass("anvil-picker-shell");
        const title = el.createDiv({ cls: "anvil-picker-title" });
        title.setText(item.name);
        if (item.isDefault) {
          title.createSpan({
            cls: "anvil-picker-default-badge",
            text: " (default)",
          });
        }
        el.createDiv({ cls: "anvil-picker-subtitle", text: item.path });
        return;
      }
      case "new-tmux":
        el.addClass("anvil-picker-new-tmux");
        el.createDiv({ cls: "anvil-picker-title", text: "New tmux session" });
        return;
      case "tmux-session":
        el.addClass("anvil-picker-tmux-session");
        el.createDiv({ cls: "anvil-picker-title", text: item.name });
        return;
    }
  }

  onChooseSuggestion(item: PickerItem, _evt: MouseEvent | KeyboardEvent): void {
    switch (item.kind) {
      case "shell":
        this.onChooseProfile({
          kind: "shell",
          path: item.path,
          name: item.name,
        });
        return;
      case "new-tmux":
        this.onChooseProfile({ kind: "new-tmux" });
        return;
      case "tmux-session":
        this.onChooseProfile({ kind: "tmux-session", name: item.name });
        return;
    }
  }

  /**
   * D3 hook: after Obsidian re-renders the suggestion list, walk the children
   * and insert section-label DOM siblings at the captured section boundaries.
   *
   * Wrapped in try/catch + feature-detect (R7) so a failure leaves the picker
   * functional with selectable rows still rendered, just without labels.
   */
  updateSuggestions(...args: unknown[]): unknown {
    if (!HAS_UPDATE_SUGGESTIONS_HOOK) return undefined;

    let result: unknown;
    try {
      const superFn = (
        SuggestModal.prototype as unknown as {
          updateSuggestions: (...a: unknown[]) => unknown;
        }
      ).updateSuggestions;
      result = superFn.apply(this, args);
    } catch {
      return undefined;
    }

    try {
      this.injectSectionLabels();
    } catch {
      // R7: silent degrade — items still rendered above, labels skipped.
    }

    return result;
  }

  private injectSectionLabels(): void {
    const container = this.resultContainerEl;
    if (!container) return;

    container
      .querySelectorAll(`:scope > .${HEADER_CLASS}`)
      .forEach((node) => node.remove());

    const labels = this.lastSectionStartLabels;
    if (labels.size === 0) return;

    const items = Array.from(
      container.querySelectorAll(":scope > .suggestion-item"),
    );

    for (const [flatIndex, label] of labels.entries()) {
      const anchor = items[flatIndex];
      if (!anchor) continue;
      const labelEl = document.createElement("div");
      labelEl.classList.add(HEADER_CLASS);
      labelEl.textContent = label;
      container.insertBefore(labelEl, anchor);
    }
  }
}
