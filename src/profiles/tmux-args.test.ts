// Tmux argv construction — Phase 2 R5/R7, AC6/AC7.
//
// Pure module; encodes the picker-dispatch decisions about how `tmux
// new-session` and `tmux attach-session` are called given the user's
// settings (preserveTmuxDimensions, tmuxSessionNameFormat) and the live
// pane's cols/rows.

import { describe, it, expect } from "vitest";
import {
  buildTmuxAttachArgs,
  buildTmuxNewSessionArgs,
  nextObsidianSessionName,
} from "./tmux-args";

describe("buildTmuxAttachArgs (AC6)", () => {
  it("preserveTmuxDimensions:false yields plain attach-session -t <name>", () => {
    const args = buildTmuxAttachArgs({
      sessionName: "work",
      cols: 100,
      rows: 30,
      preserveTmuxDimensions: false,
    });
    expect(args).toEqual(["attach-session", "-t", "work"]);
  });

  it("preserveTmuxDimensions:true appends -x <cols> -y <rows>", () => {
    const args = buildTmuxAttachArgs({
      sessionName: "work",
      cols: 120,
      rows: 40,
      preserveTmuxDimensions: true,
    });
    // Order: sub-command first, -t second, -x/-y last (mirrors how a user
    // would type it). The pin matters because tmux is positional-arg-fussy.
    expect(args).toEqual([
      "attach-session",
      "-t",
      "work",
      "-x",
      "120",
      "-y",
      "40",
    ]);
  });

  it("preserveTmuxDimensions:true with zero/negative dims falls back to no -x/-y", () => {
    // Defensive — if pane dims aren't ready (cols=0), don't pass tmux a bogus
    // size. Falling through to plain attach-session is safe.
    const args = buildTmuxAttachArgs({
      sessionName: "work",
      cols: 0,
      rows: 0,
      preserveTmuxDimensions: true,
    });
    expect(args).toEqual(["attach-session", "-t", "work"]);
  });
});

describe("buildTmuxNewSessionArgs (AC7)", () => {
  it("tmuxSessionNameFormat:'integer' (default) yields plain new-session", () => {
    const args = buildTmuxNewSessionArgs({
      tmuxSessionNameFormat: "integer",
      existingNames: [],
    });
    expect(args).toEqual(["new-session"]);
  });

  it("tmuxSessionNameFormat:'obsidian-prefix' with no existing names yields obsidian-0", () => {
    const args = buildTmuxNewSessionArgs({
      tmuxSessionNameFormat: "obsidian-prefix",
      existingNames: [],
    });
    expect(args).toEqual(["new-session", "-s", "obsidian-0"]);
  });

  it("tmuxSessionNameFormat:'obsidian-prefix' increments past existing obsidian-N names", () => {
    const args = buildTmuxNewSessionArgs({
      tmuxSessionNameFormat: "obsidian-prefix",
      existingNames: ["obsidian-0", "work", "obsidian-2"],
    });
    // Highest existing obsidian-N is 2; next is 3.
    expect(args).toEqual(["new-session", "-s", "obsidian-3"]);
  });

  it("tmuxSessionNameFormat:'obsidian-prefix' ignores non-prefix names when counting", () => {
    const args = buildTmuxNewSessionArgs({
      tmuxSessionNameFormat: "obsidian-prefix",
      existingNames: ["work", "main", "0", "1"],
    });
    expect(args).toEqual(["new-session", "-s", "obsidian-0"]);
  });
});

describe("nextObsidianSessionName (D4 / AC7)", () => {
  it("returns obsidian-0 when no obsidian-N sessions exist", () => {
    expect(nextObsidianSessionName([])).toBe("obsidian-0");
    expect(nextObsidianSessionName(["work"])).toBe("obsidian-0");
  });

  it("returns the next index after the highest existing obsidian-N", () => {
    expect(nextObsidianSessionName(["obsidian-0"])).toBe("obsidian-1");
    expect(nextObsidianSessionName(["obsidian-0", "obsidian-2"])).toBe(
      "obsidian-3",
    );
  });

  it("ignores malformed obsidian-* names that aren't integer-suffixed", () => {
    expect(nextObsidianSessionName(["obsidian-foo", "obsidian-1"])).toBe(
      "obsidian-2",
    );
  });
});
