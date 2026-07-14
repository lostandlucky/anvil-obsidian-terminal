import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execSync, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect as netConnect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";

/**
 * BUG-002 — SIGTERM latency under WS flood (bug-sweep Phase 3).
 *
 * SIGTERM-to-exit must stay sub-second even while pty-server is flooding
 * output to a dead or slow WebSocket peer. Before the fix, the session
 * loop parked inside an in-flight `ws_sink.send().await` and could not
 * observe `shutdown.trigger()` until the underlying TCP layer drained
 * (dead peer, 1–3s tail) or forever (peer connected but not reading —
 * zero TCP window, the deterministic blocked-await case).
 *
 * Harness follows `parent-death-watchdog.test.ts`: builds the release
 * binary from source in beforeAll, speaks the WS protocol with Node's
 * global WebSocket. The slow-peer variant needs raw socket control
 * (pause reading so the kernel window closes), which undici's WebSocket
 * does not expose — that client does its own minimal WS handshake over
 * `node:net`.
 *
 * Budgets: EXIT_BUDGET_MS encodes the meta-plan's "sub-second" outcome.
 * These tests are host-load sensitive; per the project flake-triage
 * protocol, a failure in a full-suite run is re-run in isolation before
 * being chased (never re-run the full suite for it).
 *
 * NOTE: the binary path used here (pty-server/target/release/...) does
 * not match the orphan smoke test's `bin/pty-server` filter, so
 * processes spawned here can never pollute its trend log even mid-test.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const CRATE_DIR = join(REPO_ROOT, "pty-server");
const BINARY = join(CRATE_DIR, "target", "release", "pty-server");
const SHELL = "/bin/zsh";
const SERVER_ARGS = ["--shell", SHELL, "--cwd", tmpdir()];

/** The meta-plan outcome: SIGTERM-to-exit stays sub-second under flood. */
const EXIT_BUDGET_MS = 1000;
/** Keep polling past the budget so RED runs record the real latency. */
const MEASURE_CAP_MS = 10_000;
/** Wire bytes that prove the `yes` flood is genuinely streaming. */
const FLOOD_BYTES = 262_144;
/** After pausing the slow peer: time for kernel buffers to fill so the
 * server's in-flight send is provably parked before SIGTERM lands. */
const SLOW_PEER_SETTLE_MS = 1200;
/** Mixed-load repeated runs backing the budget decision (meta-plan: ≥10). */
const STABILITY_RUNS = 12;

/** PIDs to reap in afterEach so a failing assertion never leaks processes. */
const cleanupPids = new Set<number>();
/** undici sockets to close in afterEach. */
const cleanupSockets = new Set<WebSocket>();
/** Raw TCP sockets to destroy in afterEach (destroy BEFORE reaping pids:
 * killing the peer unblocks any server still parked in a send). */
const cleanupRawSockets = new Set<Socket>();

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
function collectOutput(proc: ChildProcess): {
  buffer: () => string;
  waitFor: (re: RegExp, timeoutMs: number) => Promise<RegExpMatchArray>;
} {
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

async function startServer(): Promise<{ pid: number; port: number }> {
  const proc = spawn(BINARY, SERVER_ARGS, { stdio: ["ignore", "pipe", "pipe"] });
  cleanupPids.add(proc.pid!);
  const out = collectOutput(proc);
  const m = await out.waitFor(/PTY_SERVER_LISTENING port=(\d+)/, 10_000);
  return { pid: proc.pid!, port: parseInt(m[1], 10) };
}

interface Session {
  ws: WebSocket;
  /** Raw wire chars received in output frames (flood detector). */
  outputBytes: () => number;
  /** Exit messages received, in order. */
  exits: () => Array<{ status: number | null; signal: number | null }>;
  closed: () => boolean;
  /** How many Exit messages had arrived when the close event fired. */
  exitsSeenAtClose: () => number;
}

/** Opens a WS session (which makes pty-server spawn its shell child). */
function openSession(port: number): Promise<Session> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    cleanupSockets.add(ws);
    let outputBytes = 0;
    const exits: Array<{ status: number | null; signal: number | null }> = [];
    let closed = false;
    let exitsSeenAtClose = -1;
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "output") {
          outputBytes += String(ev.data).length;
        } else if (msg.type === "exit") {
          exits.push({ status: msg.status ?? null, signal: msg.signal ?? null });
        }
      } catch {
        /* non-JSON frames are not this test's concern */
      }
    });
    ws.addEventListener("close", () => {
      closed = true;
      if (exitsSeenAtClose < 0) exitsSeenAtClose = exits.length;
    });
    ws.addEventListener("open", () =>
      resolve({
        ws,
        outputBytes: () => outputBytes,
        exits: () => exits,
        closed: () => closed,
        exitsSeenAtClose: () => exitsSeenAtClose,
      }),
    );
    ws.addEventListener("error", (ev) =>
      reject(new Error(`ws error: ${String((ev as ErrorEvent).message ?? ev)}`)),
    );
  });
}

function sendInput(ws: WebSocket, text: string): void {
  ws.send(JSON.stringify({ type: "input", data: Buffer.from(text).toString("base64") }));
}

/** Minimal raw-socket WS client: handshake + masked text frames, with the
 * one capability undici hides — pausing reads so the TCP window closes. */
function rawWsConnect(port: number): Promise<{ socket: Socket; received: () => number }> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, "127.0.0.1");
    cleanupRawSockets.add(socket);
    socket.on("error", (e) => reject(e));
    let received = 0;
    let handshakeDone = false;
    let headerBuf = "";
    socket.on("data", (d: Buffer) => {
      received += d.length;
      if (!handshakeDone) {
        headerBuf += d.toString("latin1");
        if (headerBuf.includes("\r\n\r\n")) {
          if (!/ 101 /.test(headerBuf)) {
            reject(new Error(`unexpected WS handshake response:\n${headerBuf.slice(0, 300)}`));
            return;
          }
          handshakeDone = true;
          resolve({ socket, received: () => received });
        }
      }
    });
    socket.once("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write(
        `GET / HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
  });
}

/** Client→server frames must be masked (RFC 6455 §5.3). Text opcode. */
function maskedTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload, "utf-8");
  if (data.length >= 65_536) throw new Error("frame builder supports <64KiB payloads");
  const mask = randomBytes(4);
  let header: Buffer;
  if (data.length < 126) {
    header = Buffer.from([0x81, 0x80 | data.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  }
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function inputFrame(text: string): Buffer {
  return maskedTextFrame(
    JSON.stringify({ type: "input", data: Buffer.from(text).toString("base64") }),
  );
}

/** SIGTERM the server and clock until it AND its shell children are gone.
 * Polls past the budget (up to MEASURE_CAP_MS) so failing runs still
 * report a real number; Infinity = never exited within the cap. */
async function measureSigtermExit(serverPid: number, shellPids: number[]): Promise<number> {
  const start = Date.now();
  process.kill(serverPid, "SIGTERM");
  const gone = await waitUntil(
    () => !isAlive(serverPid) && shellPids.every((p) => !isAlive(p)),
    MEASURE_CAP_MS,
    10,
  );
  return gone ? Date.now() - start : Number.POSITIVE_INFINITY;
}

/** Documented BUG-002 repro: flood, then the peer goes away (JS close),
 * then SIGTERM. Pre-fix this showed a 1–3s TCP-drain tail. */
async function runDeadPeerVariant(): Promise<number> {
  const { pid, port } = await startServer();
  const session = await openSession(port);
  expect(await waitUntil(() => childPids(pid).length > 0, 10_000), "shell child never spawned").toBe(true);
  const shells = childPids(pid);
  sendInput(session.ws, "yes\n");
  expect(
    await waitUntil(() => session.outputBytes() > FLOOD_BYTES, 15_000),
    "flood never started streaming",
  ).toBe(true);
  session.ws.close();
  await sleep(100); // let the close hit the wire before the signal
  return measureSigtermExit(pid, shells);
}

/** Deterministic blocked-await case: peer stays connected but stops
 * reading, kernel buffers fill, the server's in-flight send parks on a
 * zero TCP window. Pre-fix the server could NEVER exit from SIGTERM in
 * this state (this is the case that defeats a pre-send is_set() check). */
async function runSlowPeerVariant(): Promise<number> {
  const { pid, port } = await startServer();
  const raw = await rawWsConnect(port);
  expect(await waitUntil(() => childPids(pid).length > 0, 10_000), "shell child never spawned").toBe(true);
  const shells = childPids(pid);
  raw.socket.write(inputFrame("yes\n"));
  expect(
    await waitUntil(() => raw.received() > FLOOD_BYTES, 15_000),
    "flood never started streaming",
  ).toBe(true);
  raw.socket.pause(); // stop reading; TCP window closes as buffers fill
  await sleep(SLOW_PEER_SETTLE_MS);
  return measureSigtermExit(pid, shells);
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
  // Destroy raw sockets first: a dead peer unblocks any server that is
  // still parked in a send, letting SIGTERM-based reaping work at all.
  for (const s of cleanupRawSockets) {
    try { s.destroy(); } catch { /* already gone */ }
  }
  cleanupRawSockets.clear();
  for (const ws of cleanupSockets) {
    try { ws.close(); } catch { /* already closed */ }
  }
  cleanupSockets.clear();
  for (const pid of cleanupPids) {
    if (!isAlive(pid)) continue;
    const shells = childPids(pid);
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    if (!(await waitUntil(() => !isAlive(pid), 3000))) {
      for (const c of shells) {
        try { process.kill(c, "SIGKILL"); } catch { /* gone */ }
      }
      try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
    }
  }
  cleanupPids.clear();
});

describe("SIGTERM latency under WS flood (BUG-002)", () => {
  it(
    "flood + dead peer: pty-server and its shell child exit within budget after SIGTERM",
    async () => {
      const ms = await runDeadPeerVariant();
      expect(
        ms,
        `SIGTERM-to-exit took ${ms}ms with a dead flooded peer (budget ${EXIT_BUDGET_MS}ms)`,
      ).toBeLessThanOrEqual(EXIT_BUDGET_MS);
    },
    60_000,
  );

  it(
    "flood + slow peer (connected, not reading): SIGTERM still exits within budget",
    async () => {
      const ms = await runSlowPeerVariant();
      expect(
        ms,
        `SIGTERM-to-exit took ${ms}ms while parked in a zero-window send (budget ${EXIT_BUDGET_MS}ms)`,
      ).toBeLessThanOrEqual(EXIT_BUDGET_MS);
    },
    60_000,
  );

  it(
    "repeated mixed-load runs stay within budget (drives the AC3 budget decision)",
    async () => {
      // Meta-plan decision rule: ≥10 mixed-load runs at the tightened
      // budget. Collect the full distribution first (no fail-fast) so a
      // partial-closure outcome still records the measured numbers.
      const runs: Array<{ variant: string; ms: number }> = [];
      for (let i = 0; i < STABILITY_RUNS; i++) {
        const variant = i % 2 === 0 ? "dead-peer" : "slow-peer";
        const ms = variant === "dead-peer" ? await runDeadPeerVariant() : await runSlowPeerVariant();
        runs.push({ variant, ms });
      }
      const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
      const summary =
        `min=${sorted[0]}ms median=${sorted[Math.floor(sorted.length / 2)]}ms ` +
        `max=${sorted[sorted.length - 1]}ms over ${runs.length} runs`;
      // Full distribution goes to the test log for the completion report.
      console.log(
        `SIGTERM latency distribution (${summary}):`,
        JSON.stringify(runs),
      );
      for (const { variant, ms } of runs) {
        expect(
          ms,
          `${variant} run exceeded budget: ${ms}ms > ${EXIT_BUDGET_MS}ms (${summary})`,
        ).toBeLessThanOrEqual(EXIT_BUDGET_MS);
      }
    },
    420_000,
  );

  it(
    "clean-exit protocol pin: normal child exit still delivers Exit (status 0) then WS Close",
    async () => {
      // Regression pin for the teardown block: the goodbye sequence
      // (Exit message with status, then Close frame) must survive any
      // session-loop rework. Expected green even pre-fix.
      const { pid, port } = await startServer();
      const session = await openSession(port);
      expect(await waitUntil(() => childPids(pid).length > 0, 10_000), "shell child never spawned").toBe(true);
      sendInput(session.ws, "exit 0\n");
      expect(
        await waitUntil(() => session.closed(), 10_000),
        "WS never closed after clean child exit",
      ).toBe(true);
      const exits = session.exits();
      expect(exits.length, "expected exactly one Exit message").toBe(1);
      expect(exits[0].status, "Exit message must carry the child's status").toBe(0);
      expect(exits[0].signal).toBeNull();
      expect(
        session.exitsSeenAtClose(),
        "Exit message must arrive before the WS Close frame",
      ).toBeGreaterThanOrEqual(1);
      // The server itself stays up (accept loop) after a clean session
      // end — only signals/parent death stop it. Reaped in afterEach.
      expect(isAlive(pid)).toBe(true);
    },
    30_000,
  );
});
