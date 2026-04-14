import { describe, it, expect } from "vitest";
import {
  discoverTmux,
  parseSessionNames,
  TmuxRunner,
} from "./tmux-discovery";

function runner(
  overrides: {
    whichResult?: string | null;
    listResult?: { stdout: string; exitCode: number };
  } = {},
): TmuxRunner {
  const whichResult =
    "whichResult" in overrides ? overrides.whichResult! : "/opt/homebrew/bin/tmux";
  const listResult = overrides.listResult ?? { stdout: "", exitCode: 0 };
  return {
    which: async () => whichResult,
    listSessions: async () => listResult,
  };
}

describe("parseSessionNames", () => {
  it("returns an empty array for empty output", () => {
    expect(parseSessionNames("")).toEqual([]);
  });

  it("parses newline-separated names", () => {
    expect(parseSessionNames("work\nscratch\nplay\n")).toEqual([
      "work",
      "scratch",
      "play",
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseSessionNames("work\n\nscratch\n")).toEqual(["work", "scratch"]);
  });

  it("trims trailing whitespace per line", () => {
    expect(parseSessionNames("work  \nscratch\n")).toEqual(["work", "scratch"]);
  });
});

describe("discoverTmux", () => {
  it("reports not installed when which returns null", async () => {
    const result = await discoverTmux(runner({ whichResult: null }));
    expect(result.installed).toBe(false);
    expect(result.sessions).toEqual([]);
  });

  it("reports installed with zero sessions when list exits non-zero", async () => {
    const result = await discoverTmux(
      runner({ listResult: { stdout: "", exitCode: 1 } }),
    );
    expect(result.installed).toBe(true);
    expect(result.sessions).toEqual([]);
  });

  it("reports installed with zero sessions when list stdout is empty", async () => {
    const result = await discoverTmux(
      runner({ listResult: { stdout: "", exitCode: 0 } }),
    );
    expect(result.installed).toBe(true);
    expect(result.sessions).toEqual([]);
  });

  it("reports installed sessions parsed from list-sessions output", async () => {
    const result = await discoverTmux(
      runner({
        listResult: { stdout: "work\nscratch\n", exitCode: 0 },
      }),
    );
    expect(result.installed).toBe(true);
    expect(result.sessions.map((s) => s.name)).toEqual(["work", "scratch"]);
  });

  it("returns a path to tmux when installed", async () => {
    const result = await discoverTmux(
      runner({
        whichResult: "/opt/homebrew/bin/tmux",
        listResult: { stdout: "", exitCode: 1 },
      }),
    );
    expect(result.tmuxPath).toBe("/opt/homebrew/bin/tmux");
  });

  it("returns no tmux path when not installed", async () => {
    const result = await discoverTmux(runner({ whichResult: null }));
    expect(result.tmuxPath).toBeNull();
  });
});
