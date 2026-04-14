import { describe, it, expect } from "vitest";
import {
  buildPickerItems,
  filterPickerItems,
  findDefaultShellIndex,
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

describe("buildPickerItems", () => {
  it("tmux missing: Launch new header + shell rows, no new-tmux row, no Attach section", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: "/bin/zsh",
    });

    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual(["header", "shell", "shell", "shell"]);
    expect((items[0] as { label: string }).label).toBe("Launch new");
    expect(items.find((i) => i.kind === "new-tmux")).toBeUndefined();
    expect(items.find((i) => i.kind === "tmux-session")).toBeUndefined();
  });

  it("tmux installed + 0 sessions: Launch new with shells and new-tmux row, no Attach section", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_EMPTY,
      defaultShellPath: "/bin/zsh",
    });

    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual([
      "header",
      "shell",
      "shell",
      "shell",
      "new-tmux",
    ]);
    expect(items.find((i) => i.kind === "tmux-session")).toBeUndefined();
  });

  it("tmux installed + sessions: two sections with headers, new-tmux + attach rows", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: "/bin/zsh",
    });

    const headers = items.filter((i) => i.kind === "header");
    expect(headers.map((h) => (h as { label: string }).label)).toEqual([
      "Launch new",
      "Attach to tmux session",
    ]);

    const attachNames = items
      .filter((i) => i.kind === "tmux-session")
      .map((i) => (i as { name: string }).name);
    expect(attachNames).toEqual(["work", "scratch"]);

    expect(items.some((i) => i.kind === "new-tmux")).toBe(true);
  });

  it("marks the default shell row isDefault when the path matches", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: "/bin/bash",
    });

    const shells = items.filter((i) => i.kind === "shell");
    const flags = shells.map((s) => (s as { isDefault: boolean }).isDefault);
    expect(flags).toEqual([false, true, false]);
  });

  it("no shell is marked default when the default path does not exist in the discovered list", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: "/usr/bin/nonexistent",
    });

    const shells = items.filter((i) => i.kind === "shell");
    const flags = shells.map((s) => (s as { isDefault: boolean }).isDefault);
    expect(flags).toEqual([false, false, false]);
  });

  it("no shell is marked default when defaultShellPath is null", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: null,
    });

    const shells = items.filter((i) => i.kind === "shell");
    expect(
      shells.every((s) => !(s as { isDefault: boolean }).isDefault),
    ).toBe(true);
  });
});

describe("filterPickerItems", () => {
  it("empty query returns the full list including headers", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: "/bin/zsh",
    });
    const filtered = filterPickerItems(items, "");
    expect(filtered).toEqual(items);
  });

  it("filters shell rows by name case-insensitively", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: null,
    });
    const filtered = filterPickerItems(items, "Zs");
    const names = filtered
      .filter((i) => i.kind === "shell")
      .map((i) => (i as { name: string }).name);
    expect(names).toEqual(["zsh"]);
  });

  it("filters tmux-session rows by name", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: null,
    });
    const filtered = filterPickerItems(items, "scr");
    const names = filtered
      .filter((i) => i.kind === "tmux-session")
      .map((i) => (i as { name: string }).name);
    expect(names).toEqual(["scratch"]);
  });

  it("hides a section header whose every leaf is filtered out", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: null,
    });
    const filtered = filterPickerItems(items, "scratch");
    expect(
      filtered.some(
        (i) => i.kind === "header" && (i as { label: string }).label === "Launch new",
      ),
    ).toBe(false);
    expect(
      filtered.some(
        (i) =>
          i.kind === "header" &&
          (i as { label: string }).label === "Attach to tmux session",
      ),
    ).toBe(true);
  });

  it("keeps the new-tmux row when the query matches 'tmux' or 'new'", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_EMPTY,
      defaultShellPath: null,
    });
    const filtered = filterPickerItems(items, "new tmux");
    expect(filtered.some((i) => i.kind === "new-tmux")).toBe(true);
  });

  it("returns an empty list when nothing matches", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: null,
    });
    const filtered = filterPickerItems(items, "qzqzqzqzqz");
    expect(filtered).toEqual([]);
  });
});

describe("findDefaultShellIndex", () => {
  it("returns the index of the shell row whose isDefault is true", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_POPULATED,
      defaultShellPath: "/bin/bash",
    });
    // items[0] = header, items[1] = zsh, items[2] = bash (default), items[3] = fish
    expect(findDefaultShellIndex(items)).toBe(2);
  });

  it("returns -1 when no shell is flagged default", () => {
    const items = buildPickerItems({
      shells: SHELLS,
      tmux: TMUX_MISSING,
      defaultShellPath: null,
    });
    expect(findDefaultShellIndex(items)).toBe(-1);
  });
});
