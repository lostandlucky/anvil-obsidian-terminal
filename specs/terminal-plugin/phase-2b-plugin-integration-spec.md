# Phase 2b Spec: PTY Plugin Integration

**Status:** Ready for `/phase-exec` (after 2a completes)
**Meta-plan entry:** `meta-plan.md` → Phase 2b
**Predecessors:** `phase-1-completion.md`, `phase-2a-pty-server-spec.md`, `phase-2a-completion.md`
**Inherits from 2a:** the `pty-server/` Rust binary, its WebSocket protocol (`pty-server/PROTOCOL.md`), and `docs/adr/0003-pty-backend.md`

## Objective

Wire the Phase 2a PTY server into the Obsidian plugin. Replace the mock REPL with a TypeScript backend that talks to the binary over WebSocket, get full PTY behavior end-to-end inside Obsidian (colors, signals, vim, resize, clean teardown), and ship the e2e suite that proves it.

## Decisions (carried forward, do not relitigate)

D1–D5 from the original Phase 2 spec apply unchanged. The 2a-specific aspects (Rust binary, protocol, port discovery) are now *givens* — 2b consumes them. The 2b-relevant resolutions:

- **D2 (kill-on-close):** the TS side closes its WebSocket on view-close / plugin-unload / Obsidian-quit. The 2a binary handles the rest.
- **D3 (cwd = vault root):** TS side resolves vault root via `app.vault.adapter.basePath` and passes it to the binary at handshake.
- **D4 (login shell on macOS):** TS side detects the user's `$SHELL` and passes it with the appropriate login-shell flag (`-l` for zsh/bash) to the binary at handshake.
- **D5:** `npm run build` orchestrates `cargo build --release` and copies the binary into the plugin output dir alongside `main.js`. First-run docs cover `xattr -d com.apple.quarantine`.

## Requirements

Constraints, not implementation steps.

1. **`src/pty/` directory exists** with a `TerminalBackend` interface that is the only surface `TerminalView` talks to for I/O. Minimum shape per Phase 1 notes: `write(data)`, `onData(handler)`, `resize(cols, rows)`, `close()`, `onExit(handler)`. The view does not know whether it's talking to a mock or a real shell.
2. **A real backend implementation lives in `src/pty/`** — a TS module that spawns the 2a binary as a child process, reads its handshake (port discovery), opens a WebSocket to it, and translates between the `TerminalBackend` interface and the WebSocket protocol documented in `pty-server/PROTOCOL.md`.
3. **`TerminalView.handleInput` no longer calls the mock REPL.** Input flows view → backend; output flows backend → `host.write`. The view does not parse, transform, or interpret bytes in either direction.
4. **The mock REPL is not deleted.** Keep `src/terminal/mock-repl.ts` and its unit tests — useful for offline testing and as a reference. It just stops being wired into the live view.
5. **Hotkey guard behavior is unchanged.** The `Scope` registered in Phase 1 stays exactly as it is. 2b must not weaken it to "fix" a signal-passing problem — Ctrl-C/Z/D already reach xterm's textarea and become `onData("\x03")` etc. through normal input flow.
6. **Resize is propagated.** `xterm-host.ts`'s existing `ResizeObserver`/`onResize` already fires on container resize. The backend translates `(cols, rows)` into a resize message on the WebSocket, which 2a's binary already turns into SIGWINCH. Double-fit (host + observer) is acceptable for now per Phase 1 notes; don't refactor it.
7. **Process cleanup is exhaustive.** Closing the view, unloading the plugin, and quitting Obsidian must each leave zero orphaned shell processes AND zero orphaned `pty-server` binary processes. Closing the WebSocket triggers 2a's kill-on-disconnect; the plugin must also kill the binary itself on plugin-unload / Obsidian-quit (the binary is the plugin's child process, so this should be automatic, but verify).
8. **Backend errors surface in the terminal, not the console.** If the binary fails to spawn, the handshake fails, the WebSocket dies, or the binary exits unexpectedly, the user sees a message in the xterm view (and the plugin doesn't crash). Console errors are still fine for diagnostics, but the user-visible failure mode is "the terminal told me what happened."
9. **The TS-side backend code has a unit-testable seam.** Per `testing-approach.md`'s boundary rule (a file imports from `obsidian` *or* it has unit tests), the TS code that talks to the binary must keep at least one pure module that can be Vitest-tested without standing up Obsidian — e.g., the WebSocket protocol client (framing, message construction, exit-code translation), or env-var assembly for the spawned binary.
10. **`npm run build` integration:** the build orchestrates `cargo build --release` and copies the resulting binary into the plugin output directory alongside `main.js` and `styles.css`. Verifiable by deleting the binary, running `npm run build`, and confirming it reappears.
11. **No regressions in the existing 19-test suite.** The Phase 1 e2e tests for command registration, view rendering, hotkey capture, and close/reopen must still pass unchanged.

## Acceptance criteria

Binary pass/fail. Each maps to a test or a named manual step.

- [ ] `npm test` is green: existing 19 tests pass + new Phase 2b tests pass.
- [ ] **E2E:** Opening a terminal pane and typing `echo hello` produces `hello` on the next line, in a real shell (verifiable via `ps` showing a child shell process under Obsidian).
- [ ] **E2E:** ANSI colors from a real command (`ls -G` or `printf '\e[31mred\e[0m\n'`) render as styled spans, not raw escape codes. (Phase 1 already proved this for the mock; 2b proves it end-to-end through the backend.)
- [ ] **E2E:** A long-running interactive program can be interrupted with Ctrl-C. Concretely: run `sleep 30`, send Ctrl-C, verify the prompt returns within 1s and the shell is still alive.
- [ ] **E2E:** Resizing the pane causes the shell to reflow. Concretely: with a wide pane, run a command that prints based on `$COLUMNS` (e.g. `tput cols`); shrink the pane; rerun; output reflects the new width.
- [ ] **E2E:** Closing the terminal view kills both the spawned shell process and the `pty-server` binary process. Concretely: capture child PIDs via `browser.execute` before close, then assert `kill -0 <pid>` fails after close.
- [ ] **E2E:** Unloading the plugin (disable in settings) kills any open terminal's shell AND its `pty-server` binary.
- [ ] **Manual:** `vim` opens, alternate screen activates, `:q` returns cleanly. (Hard to assert in e2e without flakiness; named manual step per `testing-approach.md` Level 3.)
- [ ] **Unit (TS):** At least one Vitest test exists for whichever pure TS module the backend client exposes (framing, env assembly, etc.).
- [ ] **`npm run build` produces a working bundle** that includes the freshly-compiled Rust binary. Verifiable by deleting the binary, running `npm run build`, and confirming it reappears.
- [ ] `phase-2b-completion.md` exists with deliverables, dependencies added, test run output, user testing steps, and downstream notes for Phase 3.

## User testing

After `npm install && npm run build` and reinstalling the plugin into a throwaway test vault (**not Vaultnacious-v2** — the Phase 1 caveat still applies):

1. **First-run quarantine fix:** if Gatekeeper blocks the binary, run `xattr -d com.apple.quarantine path/to/pty-server`. (Document the path in completion notes. Phase 4 will do this properly.)
2. **Open a terminal** — Cmd-P → "Open terminal". Pane should appear with whatever your shell's actual prompt is (zsh `%`, bash `$`, etc.) — *not* the mock `mock>` prompt.
3. **Run real commands** — `pwd`, `ls`, `echo $SHELL`. Verify `pwd` matches the vault root. Verify `$SHELL` matches your actual shell.
4. **Test PATH inheritance** — run `which brew` (or any Homebrew-installed binary). It should resolve. If it doesn't, D4's login-shell flag isn't being passed through.
5. **Test interactive programs** — run `vim`. The screen should clear, vim should take over, `:q` should return you to the prompt cleanly. Then try `htop` or `top` if available.
6. **Test signal handling** — run `sleep 30`. Press Ctrl-C. Prompt should return immediately, shell should still be alive. Run `cat` (no args) → it sits waiting for input. Press Ctrl-D. It should exit cleanly without killing the shell.
7. **Test resize** — drag the pane divider while a long line is on screen. Text should reflow, not clip or wrap weirdly. Run `tput cols` before and after to verify.
8. **Test cleanup** — open a terminal, note the processes exist (`ps aux | grep -E 'pty-server|zsh'` from another terminal). Close the Obsidian terminal pane. Both processes should be gone. Repeat with: plugin disable, Obsidian quit.
9. **Test multiple opens** — open, close, reopen, close, reopen. No console errors. No orphaned processes between cycles.

## Boundaries

What 2b **must not** touch:

- **The 2a binary itself.** If 2a's binary has a bug or its protocol needs to change, that's a 2a fix — bounce it back to 2a, don't paper over it in TS. (In practice for this single-author project, that just means commit 2a fixes separately and document them.)
- **Profile picker / shell selection UI** — Phase 3. 2b spawns one default shell (the user's `$SHELL`, as a login shell, with cwd = vault root), period.
- **tmux session attach** — Phase 3.
- **Multi-instance correctness** — Phase 3. 2b may spawn multiple, but isolation guarantees aren't part of the spec.
- **Settings UI** — Phase 4. The default shell, default cwd, etc. are hardcoded constants (or env-derived) for now.
- **Theme integration** — Phase 4.
- **Distribution packaging beyond what D5 forces** — Phase 4 owns the GitHub release.
- **The hotkey guard** — frozen. Don't touch it.
- **Mock REPL deletion** — keep it, just unwire it.
- **The double-fit issue** flagged in Phase 1 notes — leave it for a later cleanup pass.

## Sources

Read these before starting:

- `specs/terminal-plugin/phase-2a-pty-server-spec.md` and `phase-2a-completion.md` — the binary you're consuming, and what was actually built.
- `pty-server/PROTOCOL.md` — the WebSocket protocol you're implementing the client side of.
- `specs/terminal-plugin/meta-plan.md` — Phase 2b entry, shared constraints, dependency map.
- `specs/terminal-plugin/phase-1-completion.md` — especially "Notes for downstream phases" (interface shape, hotkey constraint, double-fit, bundle size).
- `specs/terminal-plugin/testing-approach.md` — boundary rule, RED/GREEN discipline, tricky e2e bits (especially focus management and async settling).
- `src/view/TerminalView.ts` — current `handleInput` shape and where the mock REPL is wired in.
- `src/terminal/xterm-host.ts` — `onData`, `onResize`, `ResizeObserver` already in place.
- `src/terminal/mock-repl.ts` + tests — reference for the seam shape.
- `docs/adr/0003-pty-backend.md` — the ADR 2a wrote; cite it in code comments where the architecture is non-obvious.
- `CLAUDE.md` → "Architecture (3 pieces)" and "Dev Setup".

## Notes from Phase 2a

The 2a binary exists, all 10 acceptance criteria pass, and the protocol is
locked in `pty-server/PROTOCOL.md`. Things 2b should bake in from day one:

- **Port discovery is one stdout line.** `^PTY_SERVER_LISTENING port=(\d+)$`.
  Logs go to stderr — don't pipe stderr into the port parser. Read exactly
  one line, then leave stdout open (the binary doesn't write more) or pipe
  it to log capture as you prefer.
- **Hyphen-prefixed shell args use the `=` form.** Spawn the binary with
  `--shell-arg=-l`, not `--shell-arg -l`. clap accepts either at the type
  level but the `=` form is what the spawn helper should always emit so
  there's no ambiguity around argv splitting.
- **`TERM` is set to `xterm-256color` if the binary's environment doesn't
  carry one.** Phase 2b passing through Obsidian's env is fine; the fallback
  is only for `wscat` sessions.
- **Closing the WebSocket is enough to kill the child shell.** No goodbye
  message needed. The binary will reply with one final `{"type":"exit",...}`
  before tearing down — treat that as the authoritative "child gone" signal
  in your `onExit` plumbing.
- **Killing the binary process kills the shell.** The binary handles
  SIGINT/SIGTERM cleanly via a sticky `AtomicBool+Notify` shutdown
  primitive (don't simplify this with bare `Notify` if you ever touch the
  Rust side — see "Bumps" in the 2a completion doc). When the plugin's
  child-process handle dies, the shell goes with it. Verify in the
  process-cleanup e2e test (acceptance criterion 7) that this holds when
  Obsidian quits.
- **One client per binary instance.** The accept loop is serial.
  Single-instance terminals match this 1:1. Phase 3 multi-instance is
  "spawn another binary on another port," not "multiplex one binary."
- **Echo-matching in e2e tests is a trap.** zsh autosuggestions / prompt
  redraw will scatter copies of typed input through the output stream. The
  2a smoke harness solved this by using `printf "MARKER=%s\\n" "$value"`
  patterns. Reuse the trick in 2b's e2e shell-output assertions.
- **First-run quarantine bit.** After every `npm run build` (or fresh
  clone), the freshly-compiled binary will need
  `xattr -d com.apple.quarantine target/release/pty-server`. Codesigning
  is Phase 4. Document this in 2b's first-run notes so it doesn't bite a
  fresh checkout.
- **No Cargo Dependabot/Renovate yet.** All 11 Rust deps are pinned to
  current-as-of-2026-04-14 versions. Worth setting up alongside the npm
  config in 2b or 4 — not blocking for 2b itself.
