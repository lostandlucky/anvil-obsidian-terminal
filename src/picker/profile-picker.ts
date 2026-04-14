import { App, SuggestModal } from "obsidian";
import type { DiscoveredShell } from "../profiles/shell-discovery";
import type { TmuxDiscoveryResult } from "../profiles/tmux-discovery";
import {
  buildPickerItems,
  filterPickerItems,
  findDefaultShellIndex,
  PickerItem,
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

export class ProfilePickerModal extends SuggestModal<PickerItem> {
  private readonly items: PickerItem[];
  private readonly onChooseProfile: (choice: ProfileChoice) => void;

  constructor(app: App, options: ProfilePickerOptions) {
    super(app);
    this.items = buildPickerItems({
      shells: options.shells,
      tmux: options.tmux,
      defaultShellPath: options.defaultShellPath,
    });
    this.onChooseProfile = options.onChoose;
    this.setPlaceholder("Choose a shell or tmux session…");
    this.limit = 500;
  }

  getSuggestions(query: string): PickerItem[] {
    return filterPickerItems(this.items, query);
  }

  onOpen(): void {
    super.onOpen();
    const defaultIndex = findDefaultShellIndex(this.items);
    if (defaultIndex < 0) return;
    const chooser = (this as unknown as { chooser?: ChooserHandle }).chooser;
    chooser?.setSelectedItem?.(defaultIndex);
  }

  renderSuggestion(item: PickerItem, el: HTMLElement): void {
    el.addClass("anvil-picker-item");
    switch (item.kind) {
      case "header":
        el.addClass("anvil-picker-header");
        el.setText(item.label);
        return;
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
      case "header":
        this.open();
        return;
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
}
