import type { DiscoveredShell } from "../profiles/shell-discovery";
import type { TmuxDiscoveryResult } from "../profiles/tmux-discovery";

export type PickerSectionLabel = "Launch new" | "Attach to tmux session";

export type PickerItem =
  | {
      kind: "shell";
      path: string;
      name: string;
      isDefault: boolean;
    }
  | { kind: "new-tmux" }
  | { kind: "tmux-session"; name: string };

export interface PickerSection {
  label: PickerSectionLabel;
  items: PickerItem[];
}

export interface BuildPickerSectionsInput {
  shells: DiscoveredShell[];
  tmux: TmuxDiscoveryResult;
  defaultShellPath: string | null;
}

export function buildPickerSections(
  input: BuildPickerSectionsInput,
): PickerSection[] {
  const sections: PickerSection[] = [];

  const launchItems: PickerItem[] = [];
  for (const shell of input.shells) {
    launchItems.push({
      kind: "shell",
      path: shell.path,
      name: shell.name,
      isDefault:
        input.defaultShellPath !== null &&
        input.defaultShellPath === shell.path,
    });
  }
  if (input.tmux.installed) {
    launchItems.push({ kind: "new-tmux" });
  }
  if (launchItems.length > 0) {
    sections.push({ label: "Launch new", items: launchItems });
  }

  if (input.tmux.installed && input.tmux.sessions.length > 0) {
    const attachItems: PickerItem[] = input.tmux.sessions.map((session) => ({
      kind: "tmux-session" as const,
      name: session.name,
    }));
    sections.push({ label: "Attach to tmux session", items: attachItems });
  }

  return sections;
}

function itemSearchText(item: PickerItem): string {
  switch (item.kind) {
    case "shell":
      return item.name;
    case "new-tmux":
      return "new tmux session";
    case "tmux-session":
      return item.name;
  }
}

export function filterPickerSections(
  sections: PickerSection[],
  query: string,
): PickerSection[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return sections.slice();

  const tokens = q.split(/\s+/);
  const matches = (item: PickerItem) => {
    const text = itemSearchText(item).toLowerCase();
    return tokens.every((t) => text.includes(t));
  };

  const result: PickerSection[] = [];
  for (const section of sections) {
    const matched = section.items.filter(matches);
    if (matched.length > 0) {
      result.push({ label: section.label, items: matched });
    }
  }
  return result;
}

export interface FlattenedSections {
  items: PickerItem[];
  /** Map from flat-index → section label, populated only for the first item of each section. */
  sectionStartLabels: Map<number, PickerSectionLabel>;
}

export function flattenSections(
  sections: PickerSection[],
): FlattenedSections {
  const items: PickerItem[] = [];
  const sectionStartLabels = new Map<number, PickerSectionLabel>();
  for (const section of sections) {
    if (section.items.length === 0) continue;
    sectionStartLabels.set(items.length, section.label);
    items.push(...section.items);
  }
  return { items, sectionStartLabels };
}

export function findDefaultShellFlatIndex(sections: PickerSection[]): number {
  let flatIndex = 0;
  for (const section of sections) {
    for (const item of section.items) {
      if (item.kind === "shell" && item.isDefault) return flatIndex;
      flatIndex += 1;
    }
  }
  return -1;
}
