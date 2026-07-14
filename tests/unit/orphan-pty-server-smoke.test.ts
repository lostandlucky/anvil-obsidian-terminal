import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Counts pty-server processes left alive on the box. NOT a hard gate — a
 * non-zero count is expected during active dogfooding and after interrupted
 * test runs. Tracked over time, an upward trend points at the lifecycle-leak
 * family — historically BUG-001 (restore path), BUG-002 (SIGTERM latency
 * under WS flood), and BUG-004 (parent-death cleanup gap), all fixed
 * 2026-07-14 by the bug-sweep (see `specs/anvil/bug-sweep/`); a new upward
 * trend after that date means a fresh leak, not those.
 *
 * Always passes. Outputs:
 *   - stderr: count + offending process lines (visible in default reporter)
 *   - logs/orphan-pty-server-counts.log: append-only trend log, gitignored.
 *     One TSV line per run: `<ISO timestamp>\tcount=<n>`. When count > 0,
 *     each orphan follows on its own `# <pid>\t<cmdline>` line.
 *     Trend lines: `grep -v '^#' logs/orphan-pty-server-counts.log`.
 */
describe("orphaned pty-server smoke check", () => {
  it("reports the count of pty-server processes still running on the box", () => {
    let psOutput: string;
    try {
      psOutput = execSync("ps -ax -o pid,command", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      process.stderr.write("[smoke] ps unavailable; skipping orphan check\n");
      return;
    }

    const orphans = psOutput.split("\n").filter((line) => {
      if (!/\bbin\/pty-server\b/.test(line)) return false;
      // Excludes unrelated tooling that happens to share the substring.
      if (/claude-shared|packages\/obsidian-mcp/.test(line)) return false;
      return true;
    });

    const count = orphans.length;
    process.stderr.write(`[smoke] orphaned pty-server processes: ${count}\n`);
    for (const line of orphans) {
      process.stderr.write(`[smoke]   ${line.trim()}\n`);
    }

    // Append to the trend log. Best-effort: log-write failures are not the
    // test's concern (e.g. a sandbox without filesystem write access).
    try {
      const logPath = join(process.cwd(), "logs", "orphan-pty-server-counts.log");
      mkdirSync(dirname(logPath), { recursive: true });
      const ts = new Date().toISOString();
      let entry = `${ts}\tcount=${count}\n`;
      for (const line of orphans) {
        entry += `# ${line.trim()}\n`;
      }
      appendFileSync(logPath, entry);
    } catch {
      /* ignore — log is a convenience, not a contract */
    }

    expect(count).toBeGreaterThanOrEqual(0);
  });
});
