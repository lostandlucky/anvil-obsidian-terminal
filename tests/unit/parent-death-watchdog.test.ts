import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execSync, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * BUG-004 — parent-death watchdog (bug-sweep Phase 2).
 *
 * pty-server must exit promptly when its parent process dies without warning
 * (Obsidian force-quit, crash, OOM) — and must NEVER exit because a live
 * session is merely quiet. These tests drive the standalone release binary
 * (built from source in beforeAll), following the shell-out pattern of
 * `orphan-pty-server-smoke.test.ts`. No wdio needed: the meta-plan names
 * this a standalone kill-the-parent test.
 *
 * Budgets: kqueue NOTE_EXIT delivery is effectively immediate; the 5s exit
 * budget is headroom for process scheduling, not a poll interval. The idle
 * window is the bounded encoding of "survives indefinitely" — the real
 * guarantee is constructional (no timer/poll mechanism exists in the
 * watchdog), reviewed at the code level.
 *
 * NOTE: the binary path used here (pty-server/target/release/...) does not
 * match the orphan smoke test's `bin/pty-server` filter, so processes
 * spawned here can never pollute its trend log even mid-test.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const CRATE_DIR = join(REPO_ROOT, "pty-server");
const BINARY = join(CRATE_DIR, "target", "release", "pty-server");
const SHELL = "/bin/zsh";
const EXIT_BUDGET_MS = 5000;
const IDLE_WINDOW_MS = 4000;

const SERVER_ARGS = ["--shell", SHELL, "--cwd", tmpdir()];

/** PIDs to reap in afterEach so a failing assertion never leaks processes. */
const cleanupPids = new Set<number>();
/** Sockets to close in afterEach. */
const cleanupSockets = new Set<WebSocket>();

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Direct children of `pid` via pgrep (empty when none / process gone). */
function childPids(pid: number): number[] {
  try {
    const out = execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((l) => parseInt(l.trim(), 10))
      .filter((n) => Number.isFinite(n));
  } catch {
    return []; // pgrep exits non-zero when there are no matches
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(
  pred: () => boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred()) return true;
    if (Date.now() > deadline) return false;
    await sleep(intervalMs);
  }
}

/** Accumulates a stream's output and lets tests await a regex match. */
function collectOutput(proc: ChildProcess): { buffer: () => string; waitFor: (re: RegExp, timeoutMs: number) => Promise<RegExpMatchArray> } {
  let buf = "";
  proc.stdout?.on("data", (d: Buffer) => (buf += d.toString()));
  proc.stderr?.on("data", (d: Buffer) => (buf += d.toString()));
  return {
    buffer: () => buf,
    waitFor: async (re, timeoutMs) => {
      const ok = await waitUntil(() => re.test(buf), timeoutMs);
      if (!ok) {
        throw new Error(`timed out waiting for ${re} in output:\n${buf}`);
      }
      return buf.match(re)!;
    },
  };
}

/** Opens a WS session (which makes pty-server spawn its shell child). */
function openSession(port: number): Promise<{ ws: WebSocket; output: () => string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    cleanupSockets.add(ws);
    let out = "";
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "output" && typeof msg.data === "string") {
          out += Buffer.from(msg.data, "base64").toString("utf-8");
        }
      } catch {
        /* non-JSON frames are not this test's concern */
      }
    });
    ws.addEventListener("open", () => resolve({ ws, output: () => out }));
    ws.addEventListener("error", (ev) => reject(new Error(`ws error: ${String((ev as ErrorEvent).message ?? ev)}`)));
  });
}

function sendInput(ws: WebSocket, text: string): void {
  ws.send(JSON.stringify({ type: "input", data: Buffer.from(text).toString("base64") }));
}

/** Graceful-then-forceful teardown that never leaves a shell orphan behind. */
async function reap(pid: number): Promise<void> {
  if (!isAlive(pid)) return;
  const shells = childPids(pid);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  if (!(await waitUntil(() => !isAlive(pid), 3000))) {
    for (const c of shells) {
      try { process.kill(c, "SIGKILL"); } catch { /* gone */ }
    }
    try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
  }
}

beforeAll(() => {
  // Build the binary from source: bin/pty-server is a gitignored build
  // artifact, so the test compiles its own truth. Cached builds are fast.
  execSync("cargo build --release", {
    cwd: CRATE_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH ?? ""}` },
  });
  expect(existsSync(BINARY)).toBe(true);
}, 240_000);

afterEach(async () => {
  for (const ws of cleanupSockets) {
    try { ws.close(); } catch { /* already closed */ }
  }
  cleanupSockets.clear();
  for (const pid of cleanupPids) {
    await reap(pid);
  }
  cleanupPids.clear();
});

describe("parent-death watchdog (BUG-004)", () => {
  it(
    "pty-server and its shell child exit within budget when the parent is SIGKILLed mid-session",
    async () => {
      // Wrapper = pty-server's parent. It forwards the server's stdout and
      // reports the child PID synchronously.
      const wrapperSrc = `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const child = spawn(process.argv[1], process.argv.slice(2), {
          stdio: ["ignore", "pipe", "pipe"],
        });
        fs.writeSync(1, "WRAPPER_CHILD_PID=" + child.pid + "\\n");
        child.stdout.on("data", (d) => process.stdout.write(d));
        child.stderr.on("data", (d) => process.stderr.write(d));
        setInterval(() => {}, 1000); // stay alive until killed
      `;
      const wrapper = spawn(process.execPath, ["-e", wrapperSrc, BINARY, ...SERVER_ARGS], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      cleanupPids.add(wrapper.pid!);
      const out = collectOutput(wrapper);

      const pidMatch = await out.waitFor(/WRAPPER_CHILD_PID=(\d+)/, 10_000);
      const ptyPid = parseInt(pidMatch[1], 10);
      cleanupPids.add(ptyPid);

      const portMatch = await out.waitFor(/PTY_SERVER_LISTENING port=(\d+)/, 10_000);
      const port = parseInt(portMatch[1], 10);

      // Open a real session so a shell child exists — the AC says "shell
      // child included, zero orphans".
      await openSession(port);
      expect(await waitUntil(() => childPids(ptyPid).length > 0, 10_000)).toBe(true);
      const shellPids = childPids(ptyPid);

      // Kill the parent the way a force-quit would: no warning, no SIGTERM
      // ever reaches pty-server, the test's own WS stays open.
      process.kill(wrapper.pid!, "SIGKILL");

      expect(
        await waitUntil(() => !isAlive(ptyPid), EXIT_BUDGET_MS),
        `pty-server ${ptyPid} still alive ${EXIT_BUDGET_MS}ms after parent death`,
      ).toBe(true);
      for (const shellPid of shellPids) {
        expect(
          await waitUntil(() => !isAlive(shellPid), EXIT_BUDGET_MS),
          `shell child ${shellPid} orphaned after parent death`,
        ).toBe(true);
      }
    },
    60_000,
  );

  it(
    "pty-server exits within budget when its parent is already dead at startup (registration race)",
    async () => {
      // The wrapper spawns pty-server and SIGKILLs itself immediately —
      // before the server can install any watch. writeSync guarantees the
      // PID line survives the wrapper's death.
      const wrapperSrc = `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const child = spawn(process.argv[1], process.argv.slice(2), {
          stdio: ["ignore", "ignore", "ignore"],
        });
        fs.writeSync(1, "WRAPPER_CHILD_PID=" + child.pid + "\\n");
        process.kill(process.pid, "SIGKILL");
      `;
      const wrapper = spawn(process.execPath, ["-e", wrapperSrc, BINARY, ...SERVER_ARGS], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      cleanupPids.add(wrapper.pid!);
      const out = collectOutput(wrapper);

      const pidMatch = await out.waitFor(/WRAPPER_CHILD_PID=(\d+)/, 10_000);
      const ptyPid = parseInt(pidMatch[1], 10);
      cleanupPids.add(ptyPid);

      expect(
        await waitUntil(() => !isAlive(ptyPid), EXIT_BUDGET_MS),
        `pty-server ${ptyPid} survived a parent that died before it finished starting`,
      ).toBe(true);
    },
    30_000,
  );

  it(
    "a long-idle live session with a live parent survives and stays responsive (no timeout reaping)",
    async () => {
      // Regression pin for the user-named negative requirement. Expected to
      // pass even at RED (nothing reaps idle sessions today); it exists to
      // fail loudly if anyone ever adds timeout-based reaping.
      const server = spawn(BINARY, SERVER_ARGS, { stdio: ["ignore", "pipe", "pipe"] });
      cleanupPids.add(server.pid!);
      const out = collectOutput(server);
      const portMatch = await out.waitFor(/PTY_SERVER_LISTENING port=(\d+)/, 10_000);
      const port = parseInt(portMatch[1], 10);

      const { ws, output } = await openSession(port);
      expect(await waitUntil(() => childPids(server.pid!).length > 0, 10_000)).toBe(true);

      // Total silence — no input, no resize — for the idle window.
      await sleep(IDLE_WINDOW_MS);

      expect(isAlive(server.pid!), "pty-server reaped an idle-but-live session").toBe(true);
      expect(childPids(server.pid!).length, "shell child reaped during idle window").toBeGreaterThan(0);

      // Still responsive after the quiet spell.
      sendInput(ws, "echo IDLE_PROBE_$((6 * 7))\n");
      expect(
        await waitUntil(() => output().includes("IDLE_PROBE_42"), 10_000),
        `shell unresponsive after idle window; output:\n${output()}`,
      ).toBe(true);
    },
    30_000,
  );

  it(
    "SIGTERM still shuts pty-server down cleanly (normal close path unchanged)",
    async () => {
      // Regression pin: the watchdog adds a shutdown *source*; the existing
      // signal path must behave exactly as before. Budget matches the
      // documented BUG-002 number (3s) — tightening it is Phase 3's job.
      const server = spawn(BINARY, SERVER_ARGS, { stdio: ["ignore", "pipe", "pipe"] });
      cleanupPids.add(server.pid!);
      const out = collectOutput(server);
      await out.waitFor(/PTY_SERVER_LISTENING port=(\d+)/, 10_000);

      process.kill(server.pid!, "SIGTERM");
      expect(
        await waitUntil(() => !isAlive(server.pid!), 3000),
        "pty-server did not exit within 3s of SIGTERM",
      ).toBe(true);
    },
    30_000,
  );
});
