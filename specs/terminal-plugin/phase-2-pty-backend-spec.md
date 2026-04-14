# Phase 2 Spec: PTY Backend Integration

**Status:** Decisions resolved — ready for `/phase-exec`
**Meta-plan entry:** `meta-plan.md` → Phase 2
**Predecessors:** `phase-1-completion.md`
**ADR slot:** `docs/adr/0003-pty-backend.md` (to be written as part of this phase)

## Objective

Replace the mock REPL with a real pseudoterminal so the plugin runs an actual shell — colors, interactive programs, signals, and resize all working — behind a `TerminalBackend` interface that hides which backend was picked.

## Decisions for review

Block on these before writing code. Resolutions get folded back into this file (mark **[RESOLVED]** with the chosen option and a one-line rationale).

### D1. PTY backend choice — **the load-bearing call**

Three candidates from the technical research note. Tradeoffs:

| Candidate | Pros | Cons |
|---|---|---|
| **Python `pty` helper** (subprocess + stdio framing) | Zero extra build infra; Python 3 ships with macOS; trivial to audit; cross-platform path is plausible later. | Spawns a Python interpreter per terminal (~15–25 MB RSS each); framing protocol is hand-rolled; relies on system Python staying installed. |
| **Rust binary + WebSocket** | Tiny RSS, fast, single static binary, no runtime deps. | Adds a Rust toolchain to the build, requires shipping/codesigning a prebuilt mach-o per arch, first-launch UX includes a binary download/permission grant, framing is now a network protocol. |
| **node-pty + prebuilts** | Cleanest API surface (it *is* the PTY), no IPC layer at all, runs in-process. | Native module → must match the exact Electron ABI Obsidian ships; ABI breaks on every Obsidian Electron bump; bundle size grows; prebuilt sourcing is its own supply-chain question. |

**Decision needed:** which one. This unblocks D2–D5 and ADR-0003.

**[RESOLVED]:** **Custom Rust binary built on the `portable-pty` crate (from the WezTerm project), communicating with the plugin over a localhost WebSocket.** We write the Rust ourselves rather than vendoring an existing project. [Termy](https://github.com/zyphrzero/termy) is prior art using the same architecture and may be read as a reference, but is not a dependency. Rationale: of the three candidates this is the only one with no native-module ABI risk, no per-terminal Python interpreter cost, and a clean process-isolation boundary between Obsidian's renderer and the spawned shell. The build-it-yourself cost is real but bounded — the Phase 2 surface is small (one PTY, one WebSocket, no multi-instance) — and writing it ourselves means we own the supply chain and the audit story end to end.

### D2. Process lifecycle scope — kill-on-close, or detach-and-reattach?

Phase 3 brings tmux session attach, which is the "real" answer to long-lived shells. For Phase 2: when the view closes, do we (a) kill the spawned shell immediately, or (b) keep it running so reopening the view reattaches?

The meta-plan's Phase 2 success criterion is "Closing the view kills the shell process cleanly," which points at (a). Confirming so we don't accidentally build state for reattach that Phase 3 then has to redo.

**[RESOLVED]:** **Kill-on-close.** Phase 3's tmux attach IS the reattach story — building a parallel persistence mechanism inside the Rust binary would be Phase 3 work shoved into Phase 2, and Phase 3 would then have to choose which one wins. Phase 2 shells are explicitly ephemeral; users wanting persistence should attach to a tmux session in Phase 3.

### D3. Initial working directory

Three reasonable defaults: vault root, `$HOME`, or "wherever Obsidian was launched from." Phase 4 will make this configurable; Phase 2 needs *one* default that isn't surprising.

**[RESOLVED]:** **Vault root** (`app.vault.adapter.basePath`). It's the answer that makes the embedded terminal feel like part of *this* vault rather than a generic shell that happens to be inside Obsidian. `$HOME` is too generic; "wherever Obsidian was launched from" is unpredictable (Dock vs Spotlight vs CLI). Phase 4 will make it user-configurable.

### D4. Login shell vs. interactive shell

Spawn the user's shell as a login shell (`-l`), interactive only, or whatever the shell's own default is when invoked without flags? Affects whether `~/.zprofile` / `~/.bash_profile` get sourced and therefore whether `PATH` matches what a Terminal.app session sees. Steve uses Homebrew, so PATH inheritance is not academic.

**[RESOLVED]:** **Login shell (`-l` or shell-equivalent), on macOS.** Terminal.app spawns login shells by default and Homebrew's `PATH` setup lives in `~/.zprofile` (login-only). Without `-l`, `which brew` would fail in the embedded terminal but work in Terminal.app — exactly the inconsistency we want to avoid. The cost is ~20–50ms of extra startup time. **This decision is macOS-specific:** on Linux, the convention flips (terminal emulators default to *non-login* interactive shells), so this should be revisited if the project ever lifts the macOS-arm64-only constraint in ADR-0001.

### D5. Backend distribution & first-run UX

Conditional on D1 (resolved as the custom Rust binary). Phase 2 ships only to Steve's machine; Phase 4 will revisit for proper release distribution.

**[RESOLVED]:**
- **Cargo workspace lives in this repo** at `pty-server/` (sibling to `src/`). Single git history, single source of truth.
- **`npm run build` orchestrates `cargo build --release`** and copies the resulting binary into the plugin output directory alongside `main.js`. Rust toolchain installed once on Steve's machine via `rustup`; CI is out of scope for Phase 2.
- **Plugin locates the binary** at a known path relative to its own install location and spawns it as a child process on first terminal open.
- **Port discovery:** binary binds to `127.0.0.1:0` (OS picks a free port) and reports the chosen port to the plugin via stderr or a handshake file. Localhost-bound only — no auth needed inside that boundary.
- **Codesigning / Gatekeeper:** **deferred to Phase 4.** For Phase 2 dogfooding on Steve's own machine, `xattr -d com.apple.quarantine path/to/binary` is acceptable and gets documented in `phase-2-completion.md`'s user testing section.
- **Audit:** since we're writing the Rust ourselves rather than vendoring a third-party binary, audit collapses into normal code review at merge time. The transitive Rust dependencies (`portable-pty`, the chosen WebSocket crate, etc.) get a one-time `cargo tree` + license check before they land.

## Requirements

Constraints, not implementation steps.

1. **`TerminalBackend` interface exists** at `src/pty/` and is the only surface `TerminalView` talks to for I/O. Minimum shape per Phase 1 notes: `write(data)`, `onData(handler)`, `resize(cols, rows)`, `close()`. Add `onExit(handler)` if the chosen backend can signal shell exit — the view needs to know to stop accepting input and show an exit indicator.
2. **`TerminalView.handleInput` no longer calls the mock REPL.** Input flows view → backend; output flows backend → `host.write`. The view does not parse, transform, or interpret bytes in either direction.
3. **The mock REPL is not deleted.** Keep `src/terminal/mock-repl.ts` and its unit tests — it's useful for offline testing and as a reference. It just stops being wired into the live view.
4. **Hotkey guard behavior is unchanged.** The `Scope` registered in Phase 1 stays exactly as it is. Phase 2 must not weaken it to "fix" a signal-passing problem — Ctrl-C/Z/D already reach xterm's textarea and become `onData("\x03")` etc. through normal input flow.
5. **Resize is propagated.** `xterm-host.ts`'s existing `ResizeObserver`/`onResize` already fires on container resize. The backend must accept `(cols, rows)` and translate to a SIGWINCH on the underlying pty. Double-fit (host + observer) is acceptable for now per Phase 1 notes; don't refactor it as part of this phase.
6. **Process cleanup is exhaustive.** Closing the view, unloading the plugin, and quitting Obsidian must each leave zero orphaned shell processes. This is testable in e2e via `ps` from `browser.execute` in a Node context, or in the test runner around an Obsidian launch/quit cycle.
7. **Backend errors surface in the terminal, not the console.** If the backend fails to spawn, exits unexpectedly, or the IPC layer dies, the user sees a message in the xterm view (and the plugin doesn't crash). Console errors are still fine for diagnostics, but the user-visible failure mode is "the terminal told me what happened."
8. **The TS-side backend code has a unit-testable seam.** Per `testing-approach.md`, the boundary rule is: a file imports from `obsidian` *or* it has unit tests. The TS code that talks to the Rust binary (WebSocket client, message framing, env-var assembly for the spawned binary, exit-code translation) must keep at least one pure module that can be Vitest-tested without standing up Obsidian.
9. **The Rust binary has its own minimal `cargo test` coverage.** At least one test on the framing/protocol layer, runnable via `cargo test` from `pty-server/`. The boundary rule from `testing-approach.md` applies on both sides of the WebSocket — we don't get to skip tests on the Rust side just because they're in a different language.
10. **`docs/adr/0003-pty-backend.md` is written and committed in this phase.** It records D1 + D5 with the actual tradeoffs considered, not a generic template. Status: Accepted. ADRs 0001 and 0002 are the format reference.
11. **No regressions in the existing 19-test suite.** The Phase 1 e2e tests for command registration, view rendering, hotkey capture, and close/reopen must still pass unchanged.

## Acceptance criteria

Binary pass/fail. Each maps to a test or a named manual step.

- [ ] `npm test` is green: existing 19 tests pass + new Phase 2 tests pass.
- [ ] **E2E:** Opening a terminal pane and typing `echo hello` produces `hello` on the next line, in a real shell (verifiable via `ps` showing a child shell process under Obsidian).
- [ ] **E2E:** ANSI colors from a real command (`ls -G` or `printf '\e[31mred\e[0m\n'`) render as styled spans, not raw escape codes. (Phase 1 already proved this for the mock; Phase 2 proves it end-to-end through the backend.)
- [ ] **E2E:** A long-running interactive program can be interrupted with Ctrl-C. Concretely: run `sleep 30`, send Ctrl-C, verify the prompt returns within 1s and the shell is still alive.
- [ ] **E2E:** Resizing the pane causes the shell to reflow. Concretely: with a wide pane, run a command that prints based on `$COLUMNS` (e.g. `tput cols`); shrink the pane; rerun; output reflects the new width.
- [ ] **E2E:** Closing the terminal view kills the spawned shell process. Concretely: capture child PID via `browser.execute` before close, then assert `kill -0 <pid>` fails after close.
- [ ] **E2E:** Unloading the plugin (disable in settings) kills any open terminal's shell.
- [ ] **Manual:** `vim` opens, alternate screen activates, `:q` returns cleanly. (Hard to assert in e2e without flakiness; named manual step per `testing-approach.md` Level 3.)
- [ ] **Unit (TS):** At least one Vitest test exists for whichever pure TS module the backend client exposes (framing, env assembly, etc.).
- [ ] **Unit (Rust):** At least one `cargo test` test exists for the Rust binary's framing/protocol layer, runnable via `cargo test` from `pty-server/`.
- [ ] **`npm run build` produces a working bundle** that includes the freshly-compiled Rust binary. Verifiable by deleting the binary, running `npm run build`, and confirming it reappears.
- [ ] `docs/adr/0003-pty-backend.md` exists with status Accepted, decision recorded, consequences honestly listed.
- [ ] `phase-2-completion.md` exists with the same shape as `phase-1-completion.md` (deliverables, dependencies added, test run output, user testing steps, downstream notes).

## User testing

After `npm install && npm run build` and reinstalling the plugin into a throwaway test vault (**not Vaultnacious-v2** — the Phase 1 caveat still applies):

1. **Open a terminal** — Cmd-P → "Open terminal". Pane should appear with whatever the chosen shell's actual prompt is (zsh `%`, bash `$`, etc.) — *not* the mock `mock>` prompt.
2. **Run real commands** — `pwd`, `ls`, `echo $SHELL`. Verify `pwd` matches whatever D3 resolved to. Verify `$SHELL` matches your actual shell.
3. **Test PATH inheritance** — run `which brew` (or any Homebrew-installed binary). It should resolve. If it doesn't, D4 needs reconsideration.
4. **Test interactive programs** — run `vim`. The screen should clear, vim should take over, `:q` should return you to the prompt cleanly. Then try `htop` or `top` if available.
5. **Test signal handling** — run `sleep 30`. Press Ctrl-C. Prompt should return immediately, shell should still be alive. Run `cat` (no args) → it sits waiting for input. Press Ctrl-D. It should exit cleanly without killing the shell.
6. **Test resize** — drag the pane divider while a long line is on screen. Text should reflow, not clip or wrap weirdly. Run `tput cols` before and after to verify.
7. **Test cleanup** — open a terminal, note the process exists (`ps aux | grep -v grep | grep zsh` from another terminal). Close the Obsidian terminal pane. The shell process should be gone. Repeat with: plugin disable, Obsidian quit.
8. **Test multiple opens** — open, close, reopen, close, reopen. No console errors. No orphaned processes between cycles.

## Boundaries

What this phase **must not** touch:

- **Profile picker / shell selection UI** — Phase 3. Phase 2 spawns one default shell (the user's `$SHELL`, as a login shell, with cwd = vault root), period.
- **tmux session attach** — Phase 3.
- **Multi-instance correctness** — Phase 3. Phase 2 may spawn multiple, but isolation guarantees aren't part of the spec.
- **Settings UI** — Phase 4. The default shell, default cwd, etc. are hardcoded constants (or env-derived) for now.
- **Theme integration** — Phase 4.
- **Distribution packaging beyond what D5 forces** — Phase 4 owns the GitHub release. Phase 2 only does what's needed to make the chosen backend *work* on Steve's machine.
- **The hotkey guard** — frozen. Don't touch it.
- **Mock REPL deletion** — keep it, just unwire it.
- **The double-fit issue** flagged in Phase 1 notes — leave it for a later cleanup pass.

## Sources

Read these before starting:

- `specs/terminal-plugin/meta-plan.md` — Phase 2 entry, shared constraints, dependency map.
- `specs/terminal-plugin/phase-1-completion.md` — especially "Notes for downstream phases" (interface shape, hotkey constraint, double-fit, bundle size).
- `specs/terminal-plugin/testing-approach.md` — boundary rule, RED/GREEN discipline, tricky e2e bits.
- `src/view/TerminalView.ts` — current `handleInput` shape and where the mock REPL is wired in.
- `src/terminal/xterm-host.ts` — `onData`, `onResize`, `ResizeObserver` already in place.
- `src/terminal/mock-repl.ts` + tests — reference for the seam shape.
- `docs/adr/0001-macos-arm64-only.md` and `0002-manual-install-only.md` — ADR format.
- Vault: `Programming/Obsidian Terminal Plugin - Technical Design Research.md` — original tradeoff analysis behind the three candidates. The "Termy approach" section (Option C) is the architectural blueprint we're following.
- [Termy](https://github.com/zyphrzero/termy) — prior-art Obsidian plugin using the same Rust + portable-pty + WebSocket architecture. Read for reference patterns on the WebSocket protocol, port discovery, and binary distribution. **Not a dependency** — we're writing our own.
- [`portable-pty` crate docs](https://docs.rs/portable-pty/) — the WezTerm PTY abstraction we're building on.
- `CLAUDE.md` → "Architecture (3 pieces)" and "Dev Setup".
