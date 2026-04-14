# Phase 2a Complete: PTY Server Spike (Rust)

**Mode:** Hybrid — code tests for the protocol framing layer + qualitative deliverables (PROTOCOL.md, ADR-0003) + an end-to-end smoke harness driving the live binary
**Cycles:** 1 (clean pass — one hidden bug found and fixed during smoke testing, see "Bumps")
**Status:** GREEN — all 10 acceptance checks pass

## Deliverables

- `pty-server/` — standalone cargo package, sibling to `src/`
  - `Cargo.toml` — exact-version pins for every direct dependency, no `^`/`~`/`*`:
    - `portable-pty=0.9.0` (WezTerm PTY abstraction)
    - `tokio=1.51.1` (with `macros`, `rt-multi-thread`, `sync`, `signal`, `io-util`, `time` features)
    - `tokio-tungstenite=0.29.0`
    - `futures-util=0.3.32`
    - `serde=1.0.228` (with `derive`)
    - `serde_json=1.0.149`
    - `base64=0.22.1`
    - `clap=4.6.0` (with `derive`)
    - `anyhow=1.0.102`
    - `tracing=0.1.44`
    - `tracing-subscriber=0.3.23`
  - `Cargo.lock` — committed
  - `.gitignore` — `target/`
  - `src/main.rs` — CLI parser, accept loop, signal handling, sticky shutdown primitive, per-session PTY + WebSocket plumbing, child cleanup
  - `src/protocol.rs` — `ClientMessage` (Input/Resize) and `ServerMessage` (Output/Exit) with parse/serialize and 7 unit tests
  - `PROTOCOL.md` — sufficient to write a client without reading the Rust source
  - `smoke-test.py` — end-to-end Python harness driving the live binary
- `docs/adr/0003-pty-backend.md` — Status: Accepted. Records D1 + D5 with the full three-candidate matrix (Python `pty` helper, `node-pty` prebuilds, custom Rust binary). Written *after* the binary worked, not before.

## Test run

```
$ cd pty-server && cargo build --release
   Compiling pty-server v0.1.0
    Finished `release` profile [optimized] target(s) in 9.81s

$ cd pty-server && cargo test
running 7 tests
test protocol::tests::parses_input_message ............... ok
test protocol::tests::parses_resize_message .............. ok
test protocol::tests::rejects_unknown_type ............... ok
test protocol::tests::rejects_malformed_json ............. ok
test protocol::tests::rejects_invalid_base64_in_input .... ok
test protocol::tests::output_message_round_trips ......... ok
test protocol::tests::exit_message_serializes ............ ok
test result: ok. 7 passed; 0 failed; 0 ignored

$ python3 pty-server/smoke-test.py
PASS: port discovery — listening on 55218
PASS: websocket connected
PASS: smoke 1 — printf output round-trips through PTY
PASS: smoke 2 — resize message changes tput cols
PASS: captured shell PID 7483
PASS: smoke 3 — shell pid 7483 cleaned up after disconnect
PASS: smoke 4 — binary SIGINT killed shell pid 7892, no orphans
```

`ps -eo pid,command | grep pty-server` after the run shows nothing — no orphans.

## Acceptance criteria — line by line

| # | Criterion | Status | Where verified |
|---|---|---|---|
| 1 | `cargo build --release` succeeds on macOS arm64 | ✓ | release build above, `target/release/pty-server` exists |
| 2 | `cargo test` is green | ✓ | 7/7 passing |
| 3 | Echo round-trip via WebSocket | ✓ | `smoke-test.py` smoke 1 (also reproducible via `wscat` per PROTOCOL.md) |
| 4 | Resize message changes `tput cols` | ✓ | `smoke-test.py` smoke 2 |
| 5 | WS disconnect kills child within 1s | ✓ | `smoke-test.py` smoke 3 — confirmed via `os.kill(pid, 0)` polling |
| 6 | SIGINT to binary leaves no orphans | ✓ | `smoke-test.py` smoke 4 |
| 7 | `docs/adr/0003-pty-backend.md` Accepted | ✓ | committed, three-candidate matrix included |
| 8 | `Cargo.lock` committed, exact pins | ✓ | `Cargo.toml` uses `=X.Y.Z` everywhere |
| 9 | `pty-server/PROTOCOL.md` written | ✓ | covers launch, port discovery, all four message types, lifecycle, `wscat` walkthrough |
| 10 | `phase-2a-completion.md` (this doc) | ✓ | you're reading it |

## User testing (the spike's "user testing")

This phase has no Obsidian-facing UX. To exercise it by hand:

1. **Build:**
   ```bash
   cd pty-server
   cargo build --release
   ```
2. **Strip the macOS quarantine bit** (first run only, until codesigning lands in Phase 4):
   ```bash
   xattr -d com.apple.quarantine target/release/pty-server 2>/dev/null || true
   ```
3. **Launch the binary** with your shell, login flag, and a working dir:
   ```bash
   ./target/release/pty-server --shell /bin/zsh --shell-arg=-l --cwd "$PWD"
   ```
   It prints `PTY_SERVER_LISTENING port=<N>` and idles.
4. **Connect via `wscat`** (in another terminal):
   ```bash
   npx wscat -c ws://127.0.0.1:<N>
   ```
   Send the example messages from `pty-server/PROTOCOL.md` → "Trying it by hand". Decode the base64 in the response to see the shell output.
5. **Or just run the smoke harness:**
   ```bash
   python3 smoke-test.py
   ```
   Self-asserting, takes ~3 seconds, exits 0 on success.

## Bumps

One bug worth recording, since it's the kind of thing that would have been a
nasty surprise in Phase 2b.

**The shutdown primitive was not sticky.** First implementation used
`tokio::sync::Notify` on its own. `Notify::notify_waiters` only wakes
*currently waiting* tasks — if no one's waiting, the notification is dropped
on the floor. The inner session loop caught the SIGINT notification and
exited cleanly, but when the outer accept loop re-entered `notified()`, the
permit was already gone and it sat waiting for the next event that would
never come. The binary stayed alive after SIGINT inside an active session.

Fix: a small `Shutdown` struct around `AtomicBool + Notify`. Setting the flag
persists; the `wait()` future checks the flag before *and* after subscribing
to the notify, so any waiter that arrives after the trigger sees it
immediately.

This is a generic Tokio gotcha and worth flagging to anyone working in this
codebase. `Notify` alone is fine for "wake whoever's waiting right now," but
shutdown signals need state.

## Notes for downstream phases

For **Phase 2b** (already specced at `phase-2b-plugin-integration-spec.md`):

- **Protocol contract is `pty-server/PROTOCOL.md`.** Read that, not the Rust
  source. Phase 2b's TS backend should implement against the document.
- **Port discovery line is `PTY_SERVER_LISTENING port=N` on stdout** —
  literal regex `^PTY_SERVER_LISTENING port=(\d+)$`. Logs go to stderr;
  stdout is reserved for that one line. Don't pipe stderr into the
  port-parsing path.
- **Hyphen-prefixed shell args need the `=` form.** `--shell-arg=-l`, not
  `--shell-arg -l`. clap is configured with `allow_hyphen_values = true` but
  argument value parsing still wants the `=` so the boundary is unambiguous.
  Bake this into whatever spawn helper Phase 2b writes.
- **`TERM=xterm-256color` is set if the parent doesn't supply one.** Phase
  2b should pass through Obsidian's environment as-is — the default fallback
  is just there so wscat sessions don't get a dumb terminal.
- **The smoke harness needs zsh autosuggestions tolerated.** If you reuse
  the harness pattern in 2b's e2e tests, beware of relying on literal echo
  matching — zsh's prompt redraw + autosuggestion plugin will scatter
  arbitrary copies of typed input into the output stream. The 2a harness
  switched to `printf "MARKER=%s\\n" "$value"` patterns specifically to
  avoid this. Same trick will work for 2b's e2e assertions.
- **Base64-encoded JSON is `~33%` overhead.** Local-loopback + a single
  terminal — fine. If 2b ever measures and finds it matters (it won't), the
  protocol can grow a binary frame variant without breaking text mode.
- **Killing the child on WS disconnect is already handled by the binary.**
  2b doesn't need to send any goodbye message — closing the WebSocket is
  enough, and the binary will reply with an `exit` message before tearing
  down. 2b's backend should treat that as the authoritative "child gone"
  signal.
- **The binary handles SIGINT/SIGTERM cleanly.** When 2b spawns it as a
  plugin child process, killing the plugin / quitting Obsidian sends the
  binary a signal and it cleans up after itself. No need for a TS-side
  "make sure the binary died" reaper, but it's worth verifying in the
  process-cleanup e2e test (acceptance criterion 7 in 2b).
- **One client at a time.** The accept loop is serial. 2b is single-instance
  for terminals-per-binary, so this matches. Phase 3's multi-instance story
  is "spawn one binary per terminal," not "multiplex one binary."
- **Codesigning is still deferred to Phase 4.** First run after `npm run
  build` (and after any git-clone-then-build) needs `xattr -d
  com.apple.quarantine target/release/pty-server`. Phase 2b's first-run docs
  should call this out explicitly so it doesn't bite a new user (or
  Steve-on-a-fresh-checkout).

For the **meta-plan**:

- Phase 2a is done. Phase 2b is the next entry — its spec already exists
  and now has an accurate predecessor binary to wire against.

## Pinned-version state at end of phase

For the next dependency-maintenance check (per CLAUDE.md cadence):

| Dep | Pinned | Latest at lock time |
|---|---|---|
| portable-pty | 0.9.0 | 0.9.0 |
| tokio | 1.51.1 | 1.51.1 |
| tokio-tungstenite | 0.29.0 | 0.29.0 |
| serde | 1.0.228 | 1.0.228 |
| serde_json | 1.0.149 | 1.0.149 |
| base64 | 0.22.1 | 0.22.1 |
| clap | 4.6.0 | 4.6.0 |
| anyhow | 1.0.102 | 1.0.102 |
| tracing | 0.1.44 | 0.1.44 |
| tracing-subscriber | 0.3.23 | 0.3.23 |
| futures-util | 0.3.32 | 0.3.32 |

All current as of 2026-04-14. No Dependabot/Renovate set up for the Rust
side yet — worth considering in Phase 2b or Phase 4 alongside the npm
config, but not blocking.

## Toolchain

- `rustc 1.94.1 (e408947bf 2026-03-25)` stable, `aarch64-apple-darwin`
- `cargo 1.94.1 (29ea6fb6a 2026-03-24)`
- Installed via `rustup` (already present on the dev machine, just needed
  `~/.cargo/env` sourced into shells)
