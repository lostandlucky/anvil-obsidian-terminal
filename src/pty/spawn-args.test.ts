import { describe, it, expect } from "vitest";
import { buildSpawnArgs, isLoginShellCapable } from "./spawn-args";

describe("isLoginShellCapable", () => {
  it("returns true for zsh", () => {
    expect(isLoginShellCapable("/bin/zsh")).toBe(true);
    expect(isLoginShellCapable("/usr/local/bin/zsh")).toBe(true);
  });

  it("returns true for bash", () => {
    expect(isLoginShellCapable("/bin/bash")).toBe(true);
  });

  it("returns false for fish (uses different login flag)", () => {
    expect(isLoginShellCapable("/usr/local/bin/fish")).toBe(false);
  });
});

describe("buildSpawnArgs", () => {
  it("emits --shell, --cwd, --cols, --rows", () => {
    const args = buildSpawnArgs({
      shell: "/bin/zsh",
      cwd: "/Users/foo/vault",
      cols: 100,
      rows: 30,
    });
    expect(args).toContain("--shell");
    expect(args).toContain("/bin/zsh");
    expect(args).toContain("--cwd");
    expect(args).toContain("/Users/foo/vault");
    expect(args).toContain("--cols");
    expect(args).toContain("100");
    expect(args).toContain("--rows");
    expect(args).toContain("30");
  });

  it("uses --shell-arg=-l (= form) for zsh login flag", () => {
    const args = buildSpawnArgs({
      shell: "/bin/zsh",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    });
    expect(args).toContain("--shell-arg=-l");
    // Make sure we did NOT emit it as two separate tokens.
    const idx = args.indexOf("--shell-arg");
    expect(idx).toBe(-1);
  });

  it("does not emit a login flag for fish", () => {
    const args = buildSpawnArgs({
      shell: "/usr/local/bin/fish",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    });
    expect(args.some((a) => a.includes("--shell-arg"))).toBe(false);
  });

  it("emits each caller-supplied shellArg as --shell-arg=<value>", () => {
    const args = buildSpawnArgs({
      shell: "/opt/homebrew/bin/tmux",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      shellArgs: ["attach-session", "-t", "work"],
    });
    expect(args).toContain("--shell-arg=attach-session");
    expect(args).toContain("--shell-arg=-t");
    expect(args).toContain("--shell-arg=work");
  });

  it("suppresses the implicit login flag when caller supplies shellArgs for zsh", () => {
    const args = buildSpawnArgs({
      shell: "/bin/zsh",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      shellArgs: ["-c", "echo hi"],
    });
    expect(args).toContain("--shell-arg=-c");
    expect(args).toContain("--shell-arg=echo hi");
    expect(args).not.toContain("--shell-arg=-l");
  });

  it("still emits the implicit login flag for zsh when no shellArgs are supplied", () => {
    const args = buildSpawnArgs({
      shell: "/bin/zsh",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    });
    expect(args).toContain("--shell-arg=-l");
  });
});
