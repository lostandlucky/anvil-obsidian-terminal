import { describe, it, expect } from "vitest";
import { discoverShells, WELL_KNOWN_SHELLS, WELL_KNOWN_PATHS } from "./shell-discovery";

function makeExists(existing: string[]): (p: string) => boolean {
  const set = new Set(existing);
  return (p: string) => set.has(p);
}

describe("discoverShells", () => {
  it("includes $SHELL when it exists on disk", () => {
    const result = discoverShells({
      envShell: "/bin/zsh",
      userShells: [],
      exists: makeExists(["/bin/zsh"]),
    });
    expect(result.map((s) => s.path)).toContain("/bin/zsh");
  });

  it("skips $SHELL when the binary does not exist", () => {
    const result = discoverShells({
      envShell: "/nonexistent/fake-shell",
      userShells: [],
      exists: makeExists([]),
    });
    expect(result.map((s) => s.path)).not.toContain("/nonexistent/fake-shell");
  });

  it("probes well-known shells across well-known paths", () => {
    const existing = [
      "/bin/bash",
      "/bin/zsh",
      "/opt/homebrew/bin/fish",
      "/usr/local/bin/nu",
    ];
    const result = discoverShells({
      envShell: undefined,
      userShells: [],
      exists: makeExists(existing),
    });
    const paths = result.map((s) => s.path);
    for (const p of existing) expect(paths).toContain(p);
  });

  it("includes user-configured shells that exist", () => {
    const result = discoverShells({
      envShell: undefined,
      userShells: ["/custom/path/myshell", "/does/not/exist"],
      exists: makeExists(["/custom/path/myshell"]),
    });
    const paths = result.map((s) => s.path);
    expect(paths).toContain("/custom/path/myshell");
    expect(paths).not.toContain("/does/not/exist");
  });

  it("dedupes when the same path appears in multiple sources", () => {
    const result = discoverShells({
      envShell: "/bin/zsh",
      userShells: ["/bin/zsh"],
      exists: makeExists(["/bin/zsh"]),
    });
    const paths = result.map((s) => s.path);
    expect(paths.filter((p) => p === "/bin/zsh")).toHaveLength(1);
  });

  it("returns name as the basename of the shell path", () => {
    const result = discoverShells({
      envShell: "/opt/homebrew/bin/fish",
      userShells: [],
      exists: makeExists(["/opt/homebrew/bin/fish"]),
    });
    const fish = result.find((s) => s.path === "/opt/homebrew/bin/fish");
    expect(fish?.name).toBe("fish");
  });

  it("returns an empty list when nothing exists", () => {
    const result = discoverShells({
      envShell: "/bin/zsh",
      userShells: ["/custom/whatever"],
      exists: makeExists([]),
    });
    expect(result).toEqual([]);
  });

  it("puts $SHELL first when it exists", () => {
    const result = discoverShells({
      envShell: "/bin/bash",
      userShells: [],
      exists: makeExists(["/bin/zsh", "/bin/bash"]),
    });
    expect(result[0]?.path).toBe("/bin/bash");
  });

  it("exports the well-known shell binary names", () => {
    for (const name of ["bash", "zsh", "fish", "nu", "sh"]) {
      expect(WELL_KNOWN_SHELLS).toContain(name);
    }
  });

  it("exports the well-known probe paths including homebrew arm64", () => {
    expect(WELL_KNOWN_PATHS).toContain("/bin");
    expect(WELL_KNOWN_PATHS).toContain("/usr/bin");
    expect(WELL_KNOWN_PATHS).toContain("/opt/homebrew/bin");
    expect(WELL_KNOWN_PATHS).toContain("/usr/local/bin");
  });
});
