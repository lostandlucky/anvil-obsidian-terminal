import type { DiscoveredShell } from "../profiles/shell-discovery";
import type { TmuxDiscoveryResult } from "../profiles/tmux-discovery";

export type PickerSectionLabel = "Launch new" | "Attach to tmux session";

export type PickerItem =
  | { kind: "header"; label: PickerSectionLabel }
  | {
      kind: "shell";
      path: string;
      name: string;
      isDefault: boolean;
    }
  | { kind: "new-tmux" }
  | { kind: "tmux-session"; name: string };

export interface BuildPickerItemsInput {
  shells: DiscoveredShell[];
  tmux: TmuxDiscoveryResult;
  defaultShellPath: string | null;
}

export function buildPickerItems(input: BuildPickerItemsInput): PickerItem[] {
  const items: PickerItem[] = [];

  items.push({ kind: "header", label: "Launch new" });
  for (const shell of input.shells) {
    items.push({
      kind: "shell",
      path: shell.path,
      name: shell.name,
      isDefault:
        input.defaultShellPath !== null &&
        input.defaultShellPath === shell.path,
    });
  }
  if (input.tmux.installed) {
    items.push({ kind: "new-tmux" });
  }

  if (input.tmux.installed && input.tmux.sessions.length > 0) {
    items.push({ kind: "header", label: "Attach to tmux session" });
    for (const session of input.tmux.sessions) {
      items.push({ kind: "tmux-session", name: session.name });
    }
  }

  return items;
}

function itemSearchText(item: PickerItem): string {
  switch (item.kind) {
    case "header":
      return item.label;
    case "shell":
      return item.name;
    case "new-tmux":
      return "new tmux session";
    case "tmux-session":
      return item.name;
  }
}

export function filterPickerItems(
  items: PickerItem[],
  query: string,
): PickerItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return items.slice();

  const tokens = q.split(/\s+/);
  const matches = (item: PickerItem) => {
    if (item.kind === "header") return false;
    const text = itemSearchText(item).toLowerCase();
    return tokens.every((t) => text.includes(t));
  };

  const result: PickerItem[] = [];
  let currentHeader: PickerItem | null = null;
  let pendingLeaves: PickerItem[] = [];

  const flushSection = () => {
    if (pendingLeaves.length > 0) {
      if (currentHeader) result.push(currentHeader);
      result.push(...pendingLeaves);
    }
    currentHeader = null;
    pendingLeaves = [];
  };

  for (const item of items) {
    if (item.kind === "header") {
      flushSection();
      currentHeader = item;
      continue;
    }
    if (matches(item)) {
      pendingLeaves.push(item);
    }
  }
  flushSection();

  return result;
}

export function findDefaultShellIndex(items: PickerItem[]): number {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "shell" && item.isDefault) return i;
  }
  return -1;
}
