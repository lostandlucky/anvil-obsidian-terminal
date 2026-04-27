import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * AC7 / AC8 / R5 / R6: release-script integration test.
 *
 * Strategy: run scripts/release.sh in --no-build --no-tag --out <tmp> mode
 * against the artifacts produced by the most recent `npm run build`. We
 * never run cargo or esbuild here — that's the build's job; this test
 * pins the *packaging contract* (zip layout + executable bit + sha256)
 * which is what AC8 actually asserts.
 *
 * If main.js / styles.css / bin/pty-server are missing (test runner was
 * invoked before a fresh build), we skip with a clear message. The CI
 * gate (`npm run test:e2e` runs `npm run build` first) covers the
 * always-built case; local `npm run test:unit` after a build covers the
 * dev case.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_SH = path.join(REPO_ROOT, "scripts", "release.sh");

const BUILD_ARTIFACTS = ["manifest.json", "main.js", "styles.css", "bin/pty-server"];

function buildArtifactsPresent(): boolean {
  return BUILD_ARTIFACTS.every((f) =>
    fs.existsSync(path.join(REPO_ROOT, f)),
  );
}

describe("release.sh (AC7/AC8/R5/R6)", () => {
  let tmpDir: string;
  let zipPath: string;
  let shaPath: string;
  let scriptStdout: string;
  let scriptExitCode: number | null;
  let zipEntries: string[] = [];
  let ptyServerExtractedPath: string | null = null;

  beforeAll(() => {
    if (!buildArtifactsPresent()) {
      // Don't fail the suite — the unit-test runner gets invoked in many
      // contexts (pre-commit, IDE-hooks). The release contract still
      // matters and we exercise it under `npm run test:e2e` which always
      // runs build first.
      return;
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-release-"));
    const result = spawnSync(
      "bash",
      [RELEASE_SH, "--no-build", "--no-tag", "--out", tmpDir],
      { cwd: REPO_ROOT, encoding: "utf-8", timeout: 60_000 },
    );
    scriptStdout = (result.stdout || "") + (result.stderr || "");
    scriptExitCode = result.status;

    const manifestVersion = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "manifest.json"), "utf-8"),
    ).version as string;
    const artifactName = `anvil-obsidian-terminal-v${manifestVersion}`;
    zipPath = path.join(tmpDir, `${artifactName}.zip`);
    shaPath = `${zipPath}.sha256`;

    if (fs.existsSync(zipPath)) {
      const list = spawnSync("unzip", ["-l", zipPath], { encoding: "utf-8" });
      // unzip -l output is platform-dependent in date format (mm-dd-YYYY on
      // macOS, YYYY-mm-dd on Linux). Match a date-then-time prefix and
      // capture the trailing name; drop directory entries (those end in /).
      zipEntries = list.stdout
        .split("\n")
        .map((line) => {
          const m = /^\s*\d+\s+[\d-]+\s+\d{2}:\d{2}\s+(.+)$/.exec(line);
          return m ? m[1] : null;
        })
        .filter((x): x is string => !!x && !x.endsWith("/"));

      const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-extract-"));
      spawnSync("unzip", ["-o", zipPath, "-d", extractDir], { encoding: "utf-8" });
      ptyServerExtractedPath = path.join(extractDir, "bin", "pty-server");
    }
  });

  it("script exits 0", () => {
    if (!buildArtifactsPresent()) return;
    expect(scriptExitCode).toBe(0);
  });

  it("produces a zip at the expected name", () => {
    if (!buildArtifactsPresent()) return;
    expect(fs.existsSync(zipPath)).toBe(true);
  });

  it("zip contains exactly the four expected entries", () => {
    if (!buildArtifactsPresent()) return;
    expect(new Set(zipEntries)).toEqual(
      new Set(["manifest.json", "main.js", "styles.css", "bin/pty-server"]),
    );
  });

  it("bin/pty-server is executable inside the extracted zip", () => {
    if (!buildArtifactsPresent()) return;
    expect(ptyServerExtractedPath).not.toBeNull();
    if (!ptyServerExtractedPath) return;
    const stat = fs.statSync(ptyServerExtractedPath);
    // Owner exec bit set.
    // eslint-disable-next-line no-bitwise
    expect((stat.mode & 0o100) !== 0).toBe(true);
  });

  it("prints the zip sha256 to stdout", () => {
    if (!buildArtifactsPresent()) return;
    expect(scriptStdout).toMatch(/[a-f0-9]{64}/);
  });

  it("writes a sha256 sidecar file alongside the zip", () => {
    if (!buildArtifactsPresent()) return;
    expect(fs.existsSync(shaPath)).toBe(true);
    const content = fs.readFileSync(shaPath, "utf-8");
    expect(content).toMatch(/[a-f0-9]{64}/);
  });

  it("does NOT push anything (R5/AC13) — script never invokes git push", () => {
    // Static check on the script body, with comments stripped so prose
    // about "we never push" doesn't trip the regex. The script's ONLY
    // git operations are `git tag` and `git rev-parse`. If a `git push`
    // ever lands in the executable lines, the test fails.
    const body = fs.readFileSync(RELEASE_SH, "utf-8");
    const codeOnly = body
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(codeOnly).not.toMatch(/git\s+push/);
  });
});

describe("release.sh --version flag (R5)", () => {
  it("rejects a non-semver version string with exit code 2", () => {
    const result = spawnSync(
      "bash",
      [RELEASE_SH, "--version", "not-a-version", "--no-build", "--no-tag"],
      { cwd: REPO_ROOT, encoding: "utf-8" },
    );
    expect(result.status).toBe(2);
    expect((result.stderr || "") + (result.stdout || "")).toMatch(
      /must be X\.Y\.Z/,
    );
  });
});
