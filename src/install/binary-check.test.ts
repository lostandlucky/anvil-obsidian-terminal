import { describe, it, expect } from "vitest";
import {
  MISSING_BINARY_NOTICE_MESSAGE,
  resolveBundledBinaryPath,
  shouldShowMissingBinaryNotice,
} from "./binary-check";

describe("resolveBundledBinaryPath", () => {
  it("places pty-server under bin/ in the plugin directory", () => {
    const result = resolveBundledBinaryPath(
      "/vault/.obsidian/plugins/anvil-obsidian-terminal",
    );
    expect(result).toBe(
      "/vault/.obsidian/plugins/anvil-obsidian-terminal/bin/pty-server",
    );
  });
});

describe("shouldShowMissingBinaryNotice (AC9)", () => {
  it("returns show=true when binary is absent", () => {
    const { show, checkedPath } = shouldShowMissingBinaryNotice({
      pluginDir: "/vault/.obsidian/plugins/anvil-obsidian-terminal",
      exists: () => false,
    });
    expect(show).toBe(true);
    expect(checkedPath).toBe(
      "/vault/.obsidian/plugins/anvil-obsidian-terminal/bin/pty-server",
    );
  });

  it("returns show=false when binary is present", () => {
    const { show } = shouldShowMissingBinaryNotice({
      pluginDir: "/vault/.obsidian/plugins/anvil-obsidian-terminal",
      exists: () => true,
    });
    expect(show).toBe(false);
  });

  it("checks the exact resolved path passed to exists()", () => {
    const probed: string[] = [];
    shouldShowMissingBinaryNotice({
      pluginDir: "/some/plugin/dir",
      exists: (p) => {
        probed.push(p);
        return true;
      },
    });
    expect(probed).toEqual(["/some/plugin/dir/bin/pty-server"]);
  });
});

describe("MISSING_BINARY_NOTICE_MESSAGE", () => {
  it("mentions pty-server so the user knows what's missing", () => {
    expect(MISSING_BINARY_NOTICE_MESSAGE).toMatch(/pty-server/);
  });

  it("points at install docs", () => {
    expect(MISSING_BINARY_NOTICE_MESSAGE).toMatch(/install\.md/);
  });

  it("identifies the plugin so multi-plugin notices are distinguishable", () => {
    expect(MISSING_BINARY_NOTICE_MESSAGE).toMatch(/Anvil/i);
  });
});
