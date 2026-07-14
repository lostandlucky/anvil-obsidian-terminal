# Implementation Brief: Phase 2 — Parent-death watchdog (BUG-004)

**Date:** 2026-07-14 · **Triage:** `phase-2-parent-death-watchdog-triage.md` (Recommendation B) · **Sign-off:** auto-approved per autonomy contract.

Spec surface: meta-plan Phase 2 block + `../known-bugs.md` BUG-004 (fix path 1, pre-approved). This brief names seams only; the TDD cycle resolves the rest.

## Architectural shape

- **`pty-server/src/main.rs`** gains a parent-death watchdog installed from `main()` alongside the existing signal-handler task, before the accept loop. It fires the existing sticky **`Shutdown` seam** (`shutdown.trigger()`) — the accept loop and the `biased` session-loop arm already observe it, and the session-loop epilogue already kills the shell child. No new teardown path.
- **Vehicle: detached plain `std::thread`, not a tokio task.** A thread blocked in `kevent()` is invisible to the tokio runtime — it cannot hold the runtime alive or block existing shutdown paths (the named risk flag), and process exit reaps it. No `AsyncFd`, no join handle.
- **Mechanism: kqueue `EVFILT_PROC | NOTE_EXIT` on the parent PID** (pre-approved constraint; substitute only if unworkable, log why). First unsafe Rust in the codebase — confine `unsafe` to the syscall sites, comment why each is sound.
- **Race sequencing** (the named registration-vs-already-dead race):
  1. `getppid()` once at install. If already `1` (reparented to launchd), the parent died before we started → trigger + done.
  2. Register the kevent watch on that PID.
  3. **Re-check `getppid()` after registration** — if it no longer matches, the parent died inside the window (registration may have bound a reaped or reused PID) → trigger + done.
  4. Block in `kevent()`; on `NOTE_EXIT` → trigger. `EINTR` retries.
- **Failure posture: never kill a live session.** On any ambiguous kqueue/kevent failure, re-check `getppid()`: parent gone → trigger; parent alive → log and leave the watchdog inactive (accepting BUG-004-shaped orphan risk over reaping a real session). This encodes the user-named negative requirement: **no timeout-based reaping of any kind** — no polling loop, no idle timers; the only inputs are the parent-exit kernel event and install-time PPID re-checks.
- **`pty-server/Cargo.toml`**: add `libc = "=0.2.185"` — pre-approved in the meta-plan shared constraints; already in the lockfile transitively at exactly that version; exact pin like every other dep.

## Anchor test

`tests/unit/parent-death-watchdog.test.ts` (vitest shelling out to the standalone binary — the `orphan-pty-server-smoke.test.ts` pattern; no wdio, per the meta-plan's "testable standalone" note). Builds `pty-server/target/release/pty-server` in `beforeAll` via `~/.cargo/bin/cargo build --release` (cached after first run; `bin/pty-server` is gitignored so the test builds its own truth from source).

1. **Kill-the-parent (RED→GREEN, the meta-plan's named test):** a `node -e` wrapper process spawns pty-server (wrapper = parent, forwards stdout); test connects a WebSocket client so a real shell child exists; SIGKILL the wrapper; assert pty-server **and** its shell child are gone within a few seconds (kqueue fires immediately; the budget is headroom, not a poll interval). Zero orphans.
2. **Parent-dead-at-startup race variant (RED→GREEN):** wrapper `fs.writeSync`s the child PID then SIGKILLs itself immediately — pty-server comes up with its parent already gone; assert it exits within budget. Exercises the step-1/step-3 race arm.
3. **Idle-survival regression pin (bounded encoding of "indefinitely"):** pty-server as a direct child of the test runner (parent alive), live WS session, zero traffic for a multi-second window → still alive AND still responsive to input afterward. Expected to pass at RED (nothing reaps today) — kept as the pin that fails if anyone ever adds timeout-based reaping.
4. **SIGTERM regression pin:** direct child, SIGTERM → exits within the documented 3s budget (BUG-002's relaxed number; do not tighten here — that's Phase 3). Expected to pass at RED.

## Tooling / operational traps

- `kevent.ident` is `uintptr_t`; `EV_ADD | EV_ENABLE`, `fflags = NOTE_EXIT`. Close the kqueue fd on every thread exit path.
- `Shutdown::trigger()` from a non-tokio OS thread is sound (`AtomicBool` + `tokio::sync::Notify` are thread-safe) — no runtime handle needed in the thread.
- Wrapper stdout must be written with `fs.writeSync(1, …)` before any self-SIGKILL, or the PID line dies in the pipe buffer.
- Test polls liveness with `process.kill(pid, 0)`; tolerate momentary zombies by polling, not one-shot asserts. Kill every spawned PID in `afterEach` — don't pollute the box the orphan smoke test is trending.
- The test binary path (`pty-server/target/release/…`) deliberately does NOT match the smoke test's `\bbin/pty-server\b` filter — no trend-log interference.
- Live-box orphans predating the fix are out of scope (triage note): do not kill live processes from tests or bookkeeping.

## Existing-test audit

- `phase-3-hygiene.e2e.ts` (AC1 disable/enable, AC3 SIGTERM ≤3s) — stays green: the watchdog only adds a trigger *source*; normal close paths are untouched.
- `pty-backend.e2e.ts`, `tab-isolation.e2e.ts`, picker/theming/glyph suites — stay green: session behavior with a live parent is unchanged.
- `tests/unit/orphan-pty-server-smoke.test.ts` — stays green by construction (always-pass trend logger).
- `pty-server` cargo tests (`protocol.rs`) — untouched; run `cargo test` once at the GREEN gate since the crate changed.
- `dependency-pins.test.ts` — unaffected (asserts npm pins only; the Cargo pin follows the exact-pin convention by inspection).

## Doc surfaces

- `specs/anvil/known-bugs.md` (remove BUG-004 on fix)
- `specs/anvil/manual-test-checklist.md` (MT-013: replace the empirically-false "≤5s — launchd reaps orphans" expectation with the watchdog behavior)
- `pty-server/PROTOCOL.md` (Lifecycle section: one line on parent-death behavior)
- `MORNING-UAT.md` (true `pkill -9 Obsidian` orphan check stays manual; dovetails with Phase 1's MT-016 entry)
- Meta-plan Phase 3 entry (downstream notes: shutdown-path state Phase 3 builds on)

## TDD ordering hint

1. RED: anchor tests 1–2 fail (pty-server survives parent death); pins 3–4 pass and are documented as such.
2. GREEN: `libc` dep + watchdog in `main.rs`; anchor tests flip → commit.
3. Bookkeeping (known-bugs, MT-013, PROTOCOL.md, MORNING-UAT, meta-plan notes) → commit.
4. Full-suite GREEN gate (unit + e2e + one `cargo test`) → completion report → commit.
