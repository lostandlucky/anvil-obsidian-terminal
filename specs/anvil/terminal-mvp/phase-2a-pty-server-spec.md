# Phase 2a Spec: PTY Server Spike (Rust)

**Status:** Ready for `/phase-exec`
**Meta-plan entry:** `meta-plan.md` → Phase 2a
**Predecessors:** `phase-1-completion.md`
**Successor:** `phase-2b-plugin-integration-spec.md`
**ADR slot:** `docs/adr/0003-pty-backend.md` (written at the *end* of 2a, after the binary works)

## Objective

Build a standalone Rust binary that creates a PTY, spawns a shell, and exposes it over a localhost WebSocket. Verifiable in isolation with `wscat` (or any WebSocket client) — no Obsidian, no TypeScript, no plugin code. This phase exists to retire all the unfamiliar Rust + PTY + WebSocket risk in isolation before Phase 2b wires it into the plugin.

This mirrors the Phase 0 → Phase 1 split: prove the unfamiliar component works as a thing in itself, then build on top of it in the next phase.

## Decisions (carried forward, do not relitigate)

D1–D5 were resolved in the original Phase 2 spec. They apply to 2a wherever relevant:

- **D1:** Custom Rust binary on `portable-pty` (WezTerm crate) + localhost WebSocket. Termy is prior art (`https://github.com/zyphrzero/termy`) — read for reference, not a dependency.
- **D2:** Kill-on-close (Phase 3's tmux is the reattach story).
- **D3:** Initial cwd = vault root. *2a doesn't know what a vault is — the binary accepts cwd as a config/CLI input. The vault-root resolution happens in 2b.*
- **D4:** Login shell on macOS. *Same — 2a accepts shell + args as input; 2b passes the right args.*
- **D5:** Cargo workspace at `pty-server/`, sibling to `src/`. Built standalone via `cargo build --release` in 2a; `npm run build` integration is a 2b concern.

## Requirements

Constraints, not implementation steps.

1. **`pty-server/` cargo workspace exists** at the repo root, sibling to `src/`. Builds via `cargo build --release` from inside that directory. Pinned dependencies (exact versions in `Cargo.toml`, committed `Cargo.lock`) per the project's pinning convention from Phase 0.
2. **Binary creates a real PTY** using the `portable-pty` crate, spawns a configurable shell as a child process, and proxies bytes between the PTY and a WebSocket client.
3. **Shell, args, and cwd are inputs** — passed as CLI args, env vars, or a small JSON config message at WebSocket handshake. The binary does not hardcode "zsh" or any path. It is told what to spawn.
4. **WebSocket protocol is documented** in a short markdown file inside `pty-server/` (e.g. `pty-server/PROTOCOL.md`). Covers: input messages (raw bytes from client → PTY), output messages (raw bytes from PTY → client), resize messages (cols, rows → SIGWINCH), exit notification (PTY child exited, with status). Whatever framing the binary uses (text JSON, binary, length-prefixed) is the protocol — just make it explicit so 2b can implement the client without reverse-engineering the source.
5. **Port discovery:** binary binds to `127.0.0.1:0` (OS picks a free port) and reports the chosen port — either to stdout/stderr in a parseable line, or by writing a handshake file at a path passed via CLI. Pick whichever is simpler; document in `PROTOCOL.md`. Bound to localhost only; no auth needed inside that boundary.
6. **Resize works:** the binary accepts `(cols, rows)` resize messages from the WebSocket and translates them to `set_size` on the PTY (which sends SIGWINCH to the child). Verifiable manually by sending a resize message and observing `tput cols` change.
7. **Process cleanup:** when the WebSocket client disconnects, the binary kills its PTY child cleanly. When the binary itself receives SIGTERM/SIGINT, it kills the child before exiting. No orphans.
8. **`cargo test` covers the framing/protocol layer.** At least one meaningful test on the message framing — parse a sample, round-trip, error case. Per `../testing-approach.md`'s boundary rule, the Rust side gets the same testability discipline as the TS side.
9. **`docs/adr/0003-pty-backend.md` exists, status Accepted.** Records D1 + D5 with the actual tradeoffs considered (the three-candidate matrix from the original spec). Written at the *end* of 2a, after the binary works — the ADR records a validated decision, not a speculative one. ADRs 0001 and 0002 are the format reference.
10. **Pinned versions, committed lock file.** `Cargo.lock` checked in. Exact version pins for `portable-pty` and the chosen WebSocket crate (e.g. `tokio-tungstenite`). Mirrors Phase 0's pinning discipline for the same reasons (reproducibility, deliberate upgrades).

## Acceptance criteria

Binary pass/fail.

- [ ] `cd pty-server && cargo build --release` succeeds on macOS arm64.
- [ ] `cd pty-server && cargo test` is green.
- [ ] **Manual smoke test:** launch the binary; connect to its WebSocket via `wscat` or equivalent; the binary spawns the configured shell; bytes typed in `wscat` reach the shell and shell output reaches `wscat`. Concretely: `echo hello` produces `hello`. (Document the exact `wscat` command in `PROTOCOL.md`.)
- [ ] **Manual smoke test:** sending a resize message changes `tput cols` output inside the spawned shell.
- [ ] **Manual smoke test:** disconnecting the WebSocket client kills the spawned shell process within 1s. Verify with `ps` from another terminal.
- [ ] **Manual smoke test:** killing the binary itself (Ctrl-C in its terminal) leaves no orphaned shell processes.
- [ ] `docs/adr/0003-pty-backend.md` exists with status Accepted, decision recorded, consequences honestly listed.
- [ ] `Cargo.lock` is committed; `Cargo.toml` uses exact version pins.
- [ ] `pty-server/PROTOCOL.md` exists and is sufficient for someone to write a client without reading the Rust source.
- [ ] `phase-2a-completion.md` exists with deliverables, dependencies added, manual smoke test run output, and notes for Phase 2b.

## Manual testing (the spike's "user testing")

This phase has no Obsidian-facing UX, so "user testing" is the developer running the binary by hand.

1. **Launch the binary** with a config that points at your shell, args (`-l` for login), and cwd. It should print the chosen port and idle waiting for a WebSocket client.
2. **Connect with `wscat`:** `wscat -c ws://127.0.0.1:<port>` (or the documented client command). Type a few characters — they should appear in the spawned shell's view, and the shell's prompt + output should appear in the `wscat` session.
3. **Run a real command** through the WebSocket: `echo $SHELL`, `which brew`, `ls`. Verify output looks right and that login-shell PATH inheritance is working (since you passed `-l`).
4. **Send a resize message** and verify `tput cols` changes inside the shell.
5. **Disconnect the WebSocket client** — verify via `ps` that the shell process is gone within 1s.
6. **Reconnect** and repeat — confirm the binary handles serial connections cleanly.
7. **Send Ctrl-C to the binary itself** — verify the spawned shell is also killed (no orphans).

## Boundaries

What 2a **must not** touch:

- **Anything in `src/`** — that's 2b. No TypeScript, no `TerminalView` changes, no `TerminalBackend` interface.
- **`npm run build` integration** — 2b. 2a's binary is built directly via `cargo build --release` for now.
- **Obsidian, plugin loading, e2e tests** — 2b.
- **The mock REPL** — left alone, still wired in. 2b unwires it.
- **Anything on the meta-plan's Phase 3 / Phase 4 list** — profile picker, tmux, multi-instance, settings, theme, distribution.
- **Codesigning / Gatekeeper** — Phase 4. For 2a, `xattr -d com.apple.quarantine` on first run is fine and gets documented in `phase-2a-completion.md`.

## Sources

Read these before starting:

- `meta-plan.md` — Phase 2a entry, shared constraints.
- `phase-0-harness-spec.md` and `phase-0-completion.md` — format reference for spike-style spec/completion docs. 2a is the same shape as Phase 0 (de-risk an unfamiliar component in isolation).
- `../testing-approach.md` — boundary rule, RED/GREEN discipline. The Rust side inherits the same discipline.
- Vault: `Programming/Obsidian Terminal Plugin - Technical Design Research.md` — original tradeoff analysis. The "Option C: Rust binary + portable-pty + WebSocket" section is the architectural blueprint.
- [Termy](https://github.com/zyphrzero/termy) — prior-art Obsidian plugin using the same architecture. Read for reference patterns on the WebSocket protocol, port discovery, codesigning workarounds. **Not a dependency.**
- [`portable-pty` crate docs](https://docs.rs/portable-pty/) — the WezTerm PTY abstraction we're building on.
- `docs/adr/_template.md`, `0001-macos-arm64-only.md`, `0002-manual-install-only.md` — ADR-0003 format reference.
