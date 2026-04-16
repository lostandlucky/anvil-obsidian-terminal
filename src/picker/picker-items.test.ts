import { describe, it, expect } from "vitest";
import {
  buildPickerSections,
  filterPickerSections,
  flattenSections,
  findDefaultShellFlatIndex,
} from "./picker-items";
import type { DiscoveredShell } from "../profiles/shell-discovery";
import type { TmuxDiscoveryResult } from "../profiles/tmux-discovery";

const SHELLS: DiscoveredShell[] = [
  { path: "/bin/zsh", name: "zsh" },
  { path: "/bin/bash", name: "bash" },
  { path: "/opt/homebrew/bin/fish", name: "fish" },
];

const TMUX_MISSING: TmuxDiscoveryResult = {
  installed: false,
  tmuxPath: null,
  sessions: [],
};

const TMUX_EMPTY: TmuxDiscoveryResult = {
  installed: true,
  tmuxPath: "/opt/homebrew/bin/tmux",
  sessions: [],
};

const TMUX_POPULATED: TmuxDiscoveryResult = {
  installed: true,
  tmuxPath: "/opt/homebrew/bin/tmux",
  sessions: [{ name: "work" }, { name: "scratch" }],
};

describe("buildPickerSections", () => {
  it("tmux missing: single Launch new section with shells, no tmux section", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: "/bin/zsh",
    });

    expect(sections.map((s) => s.label)).toEqual(["Launch new"]);
    expect(sections[0].items.map((i) => i.kind)).toEqual([
      "shell",
      "shell",
      "shell",
    ]);
  });

  it("tmux installed + 0 sessions: Launch new with shells and new-tmux row, no Attach section", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_EMPTY,
      defaultShellPath: "/bin/zsh",
    });

    expect(sections.map((s) => s.label)).toEqual(["Launch new"]);
    expect(sections[0].items.map((i) => i.kind)).toEqual([
      "shell",
      "shell",
      "shell",
      "new-tmux",
    ]);
  });

  it("tmux installed + sessions: two sections — Launch new and Attach to tmux session", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: "/bin/zsh",
    });

    expect(sections.map((s) => s.label)).toEqual([
      "Launch new",
      "Attach to tmux session",
    ]);

    const attachNames = sections[1].items
      .filter((i) => i.kind === "tmux-session")
      .map((i) => (i as { name: string }).name);
    expect(attachNames).toEqual(["work", "scratch"]);

    expect(sections[0].items.some((i) => i.kind === "new-tmux")).toBe(true);
  });

  it("section items never include a header sentinel", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: null,
    });
    for (const section of sections) {
      for (const item of section.items) {
        // structural guarantee: PickerItem union no longer has "header"
        expect(item.kind).not.toBe("header");
      }
    }
  });

  it("marks the default shell row isDefault when the path matches", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: "/bin/bash",
    });

    const shells = sections[0].items.filter((i) => i.kind === "shell");
    const flags = shells.map((s) => (s as { isDefault: boolean }).isDefault);
    expect(flags).toEqual([false, true, false]);
  });

  it("no shell is marked default when the default path does not exist in the discovered list", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: "/usr/bin/nonexistent",
    });

    const shells = sections[0].items.filter((i) => i.kind === "shell");
    const flags = shells.map((s) => (s as { isDefault: boolean }).isDefault);
    expect(flags).toEqual([false, false, false]);
  });

  it("no shell is marked default when defaultShellPath is null", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: null,
    });

    const shells = sections[0].items.filter((i) => i.kind === "shell");
    expect(
      shells.every((s) => !(s as { isDefault: boolean }).isDefault),
    ).toBe(true);
  });
});

describe("filterPickerSections", () => {
  it("empty query returns all sections unchanged", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: "/bin/zsh",
    });
    const filtered = filterPickerSections(sections, "");
    expect(filtered).toEqual(sections);
  });

  it("filters shell rows by name case-insensitively", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: null,
    });
    const filtered = filterPickerSections(sections, "Zs");
    const names = filtered
      .flatMap((s) => s.items)
      .filter((i) => i.kind === "shell")
      .map((i) => (i as { name: string }).name);
    expect(names).toEqual(["zsh"]);
  });

  it("filters tmux-session rows by name", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: null,
    });
    const filtered = filterPickerSections(sections, "scr");
    const names = filtered
      .flatMap((s) => s.items)
      .filter((i) => i.kind === "tmux-session")
      .map((i) => (i as { name: string }).name);
    expect(names).toEqual(["scratch"]);
  });

  it("drops sections that have zero matching items after filtering", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: null,
    });
    const filtered = filterPickerSections(sections, "scratch");
    // "scratch" matches in tmux section only
    expect(filtered.map((s) => s.label)).toEqual(["Attach to tmux session"]);
  });

  it("keeps the new-tmux row when the query matches 'tmux' or 'new'", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_EMPTY,
      defaultShellPath: null,
    });
    const filtered = filterPickerSections(sections, "new tmux");
    const kinds = filtered.flatMap((s) => s.items).map((i) => i.kind);
    expect(kinds).toContain("new-tmux");
  });

  it("returns an empty array when nothing matches", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: null,
    });
    const filtered = filterPickerSections(sections, "qzqzqzqzqz");
    expect(filtered).toEqual([]);
  });
});

describe("flattenSections", () => {
  it("returns items in section order with per-index section-label map", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: null,
    });
    const { items, sectionStartLabels } = flattenSections(sections);

    // 3 shells + 1 new-tmux + 2 sessions = 6 items
    expect(items.length).toBe(6);
    // First item of section 0 ("Launch new") at flat index 0
    expect(sectionStartLabels.get(0)).toBe("Launch new");
    // First item of section 1 ("Attach to tmux session") at flat index 4
    expect(sectionStartLabels.get(4)).toBe("Attach to tmux session");
    // Other indices have no label
    expect(sectionStartLabels.get(1)).toBeUndefined();
    expect(sectionStartLabels.get(5)).toBeUndefined();
  });

  it("empty sections yield empty items and empty label map", () => {
    const { items, sectionStartLabels } = flattenSections([]);
    expect(items).toEqual([]);
    expect(sectionStartLabels.size).toBe(0);
  });
});

describe("findDefaultShellFlatIndex", () => {
  it("returns the flat index of the default shell across all sections", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: "/bin/bash",
    });
    // Section 0: zsh(0), bash(1), fish(2), new-tmux(3); section 1: work(4), scratch(5)
    expect(findDefaultShellFlatIndex(sections)).toBe(1);
  });

  it("returns -1 when no shell is flagged default", () => {
    const sections = buildPickerSections({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: null,
    });
    expect(findDefaultShellFlatIndex(sections)).toBe(-1);
  });
});
