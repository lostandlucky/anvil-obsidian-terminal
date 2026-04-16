# Meta-Plan: Obsidian Terminal Plugin

## Context

Steve wants a custom Obsidian plugin that embeds a real system terminal — not because it doesn't exist, but because he doesn't trust third-party plugins with terminal access. The plugin should work like VS Code's terminal: discover available shells, let you pick one, and also attach to existing tmux sessions. The technical research is complete (see vault: `Programming/Obsidian Terminal Plugin - Technical Design Research.md`).

**Project location:** `~/dev/anvil-obsidian-terminal/`
**Specs location:** `~/dev/anvil-obsidian-terminal/specs/anvil/`

## Scope

**IN:** Obsidian plugin that opens terminal panes with real PTY-backed shells, profile picker for shell/session selection, tmux session attach, multiple concurrent instances, settings UI, macOS distribution.

**OUT:** Cross-platform support (Linux/Windows deferred), community plugin store submission (manual install only initially), custom shell implementation, pane-level tmux integration (control mode).

## Shared Constraints

- **PTY backend choice:** The biggest architectural decision. Three viable options (Python pty helper, Rust binary + WebSocket, node-pty with prebuilt binaries). Decision must be locked before Phase 2. This is a cross-phase concern — it affects build tooling, distribution, and the data path between xterm.js and the shell.
- **macOS arm64 primary target:** All phases target Steve's machine first. Other platforms are explicitly out of scope.
- **Obsidian plugin conventions:** TypeScript, esbuild, manifest.json, styles.css. Plugin runs in Electron renderer with Node.js access.
- **Dev-loop reload ergonomics (2b+):** Obsidian caches loaded plugin JavaScript — `main.js` changes are not picked up by a running Obsidian until the plugin is toggled off/on, the app is reloaded, or the "Hot Reload" community plugin (`pjeby/hot-reload`) is installed to auto-toggle on file change. The Rust binary layer is fine: each new terminal view spawns a fresh child, so rebuilt binaries are picked up by simply closing and reopening the view. Only the JS layer is sticky. Manual reload is acceptable for now; Hot Reload is worth considering if iteration speed starts to hurt.

## Dependency Map

```
Phase 0 → Phase 1 → Phase 2a → Phase 2b → Phase 3 → Phase 4
```

Strictly sequential. Phase 2 is split into 2a (Rust PTY server spike, in isolation) and 2b (plugin integration, consumes 2a's binary). The split mirrors Phase 0 → Phase 1 — de-risk an unfamiliar component as a thing in itself before building on top of it. Phase 3's picker UI could start in parallel with late Phase 2b, but session features need a working PTY. Phase 0 gates everything — if the e2e harness spike fails, the testing strategy changes before Phase 1 begins.

---

## Phase 0: Test Harness Spike + Dependency Audit

**Goal:** De-risk the entire testing strategy before any feature code is written. Prove that `wdio-obsidian-service` can stand up on macOS arm64 against a pinned Obsidian version, and audit the package's source since it runs in the test environment with filesystem and network access. This phase exists because the e2e harness is solo-maintained community tooling and `testing-approach.md` commits to it as infrastructure — that commitment needs evidence before Phase 1 builds on it.

**Dependencies:** None.

**Time box:** One working day for the smoke test. If it's not green by end-of-day, stop and execute the fallback documented in `testing-approach.md` (Vitest units + manual checklist, revisit e2e in Phase 2).

**Scope:**
1. **Source audit of `wdio-obsidian-service`.** Read the package's source on GitHub. Specifically check: what it downloads and from where, how it verifies the Obsidian binary (checksum? signature? bare HTTP?), what lifecycle hooks it runs in the test env, what it writes to disk outside the project directory. Record findings in `specs/anvil/phase-0-audit.md`. If anything looks actively unsafe, stop and reassess.
2. **Pin versions.** Exact pins (not semver ranges) for `wdio-obsidian-service` in `package.json` and the Obsidian test binary version in the wdio config. Commit `package-lock.json`. Wire up Dependabot or Renovate against these so future upgrades come as reviewable PRs.
3. **Smoke-test harness.** A single trivial e2e spec: launch Obsidian via the service, assert the workspace loaded, quit cleanly. No plugin code involved yet — this tests only the harness, on this machine, on this OS.
4. **Vitest skeleton.** `npm test`, `npm run test:unit`, `npm run test:e2e` scripts exist and route correctly. One trivial unit test to confirm Vitest runs.
5. **Document the setup.** Brief notes in `specs/anvil/phase-0-spec.md` on how to run each test level locally and what the pinned versions are.

**Success criteria:**
- Audit notes committed, with an explicit "safe to adopt / not safe to adopt" conclusion.
- `wdio-obsidian-service` and Obsidian binary pinned to exact versions; Dependabot/Renovate config present.
- Smoke e2e test runs green locally via `npm run test:e2e`.
- Trivial Vitest unit test runs green via `npm run test:unit`.
- `npm test` runs both in sequence.

**Risk flags:**
- Chromedriver / Electron / arm64 binary mismatches on macOS.
- Obsidian binary download fails, is unverified, or is gated behind auth.
- Audit uncovers something that makes the package unsafe to run (e.g. unverified downloads, arbitrary code execution outside the test sandbox).
- Harness stands up but is flaky from the first run — flakiness now compounds later.

**Exit condition if time-boxed out:** Document what was tried, what broke, and invoke the fallback. Phase 1 proceeds with unit tests + manual checklist only; Phase 2 reopens the e2e question.

---

## Phase 1: Plugin Scaffold + Terminal Rendering

**Goal:** Get an Obsidian plugin that opens a pane with xterm.js rendering in it. No real shell yet — just prove that xterm.js works inside Obsidian's view system, handles resize, and captures keystrokes without Obsidian intercepting them. This retires all the Obsidian plugin API risk before adding PTY complexity.

**Dependencies:** Phase 0 complete (or fallback invoked).

**Success criteria:**
- Plugin loads in Obsidian, command palette action opens a terminal pane
- xterm.js renders and responds to resize (FitAddon works with Obsidian layout)
- Keystrokes go to xterm.js, not Obsidian hotkeys (Ctrl-C, Ctrl-P, etc.)
- View survives layout changes (drag, split, close/reopen)

**Risk flags:**
- Obsidian's key event system may fight xterm.js for certain hotkeys
- xterm.js CSS may conflict with Obsidian themes

---

## Phase 2a: PTY Server Spike (Rust)

**Goal:** Build a standalone Rust binary that creates a PTY, spawns a configurable shell, and exposes it over a localhost WebSocket. Verifiable in isolation with `wscat` — no Obsidian, no TypeScript, no plugin code. This phase de-risks the entire Rust + portable-pty + WebSocket architecture before any plugin integration work begins.

**Dependencies:** Phase 1 complete. D1–D5 already resolved (see `phase-2a-pty-server-spec.md`): custom Rust binary on `portable-pty`, kill-on-close, login shell, vault-root cwd, cargo workspace at `pty-server/`.

**Spec:** `specs/anvil/phase-2a-pty-server-spec.md`

**Success criteria:**
- `pty-server/` cargo workspace builds cleanly via `cargo build --release` on macOS arm64
- `cargo test` covers the framing/protocol layer
- `wscat` smoke test: connect to the binary, type `echo hello`, see `hello`
- Resize messages translate to SIGWINCH (verifiable via `tput cols`)
- Disconnecting the WebSocket kills the spawned shell within 1s; killing the binary leaves no orphans
- `pty-server/PROTOCOL.md` documents the WebSocket protocol well enough to write a client without reading the Rust source
- `docs/adr/0003-pty-backend.md` written and accepted (at the *end* of 2a, after the binary works — the ADR records a validated decision)
- `Cargo.lock` committed; exact version pins in `Cargo.toml`

**Risk flags:**
- First-time Rust toolchain setup on the dev machine
- WebSocket framing protocol design (binary vs JSON, single-frame vs multiplexed)
- `portable-pty` API surface unfamiliarity
- Codesigning / Gatekeeper on first binary launch (workaround: `xattr -d com.apple.quarantine`; proper fix in Phase 4)

---

## Phase 2b: PTY Plugin Integration

**Goal:** Wire the 2a binary into Obsidian. Replace the mock REPL with a TS backend that talks to the binary over WebSocket, get full PTY behavior end-to-end inside the plugin, and ship the e2e suite that proves it.

**Dependencies:** Phase 2a complete (binary, protocol, ADR-0003 all in place).

**Spec:** `specs/anvil/phase-2b-plugin-integration-spec.md`

**Success criteria:**
- Commands execute in a real shell with correct output
- ANSI colors and formatting work
- Interactive programs work (vim opens, Ctrl-C interrupts)
- Pane resize sends SIGWINCH, shell reflows correctly
- Closing the view kills both the shell process and the `pty-server` binary cleanly
- `npm run build` orchestrates `cargo build --release` and copies the binary into the plugin output dir
- No regressions in the existing 19-test suite

**Risk flags:**
- Shell environment inheritance (PATH, env vars, working directory) — D4 should handle it but verify
- WebSocket client / handshake races on plugin load
- E2E test flakiness around process cleanup assertions (`kill -0` timing)

**Notes from Phase 1 (see `phase-1-completion.md` for full detail):**
- Replace `TerminalView.handleInput` with a `TerminalBackend` interface (`write`, `onData`, `resize`, `close`). Expected location: `src/pty/`. The view should not know whether it's talking to a mock or a real shell.
- The Obsidian `Scope` hotkey guard is load-bearing and must not be removed. It only blocks hotkey *actions*, not text input — Ctrl-C, Ctrl-Z, Ctrl-D etc. still reach the PTY via xterm's textarea.
- Real Ctrl-C from a user will generate an xterm `onData("\x03")` event. Wire that to the PTY write path; don't short-circuit it at the view layer.
- SIGWINCH: xterm `onResize` already fires on container resize via `ResizeObserver` in `xterm-host.ts`. Backend needs to accept `resize(cols, rows)` and propagate via the WebSocket to 2a's binary.
- `main.js` bundle is already ~340KB from xterm + fit addon. The 2a binary lives alongside it as a separate file, not bundled.
- E2E harness fully works against the fixture vault at `tests/e2e/fixtures/vault/`. 2b can add real-shell e2e tests on the same harness — no infra work needed.

---

## Phase 3: Profile Picker, Session Management + Multi-Instance

**Goal:** Add the VS Code-style profile picker that discovers shells and tmux sessions, the ability to attach to existing tmux sessions, and support for multiple concurrent terminal instances. These combine into one phase because they share the same abstraction — "what command to pass to the PTY" — and the same UI surface.

**Dependencies:** Phase 2b complete. tmux installed for session features (graceful fallback if absent).

**Success criteria:**
- Picker modal lists discovered shells and running tmux sessions
- User can launch a new shell or attach to an existing tmux session
- Multiple terminal instances run in separate Obsidian panes simultaneously
- Each instance independently closable
- Graceful handling when tmux isn't installed or has no sessions

**Risk flags:**
- Shell discovery edge cases (Homebrew shells, nix, non-standard paths)
- tmux server not running → `tmux list-sessions` fails
- Resource consumption with multiple instances

### Notes from Phase 2b

- **One backend per terminal view, one binary per backend.** `PtyBackend` has no shared state — Phase 3's multi-instance model is "spawn another binary on another port," and that just works as-is.
- **Profile selection lives between `TerminalView` and `PtyBackend`.** Today the view hardcodes `process.env.SHELL || "/bin/zsh"` and vault root as cwd. A profile picker should resolve to a `{shell, args, cwd, env}` object and pass it into `PtyBackend`'s constructor — the backend doesn't care where the values came from.
- **The `TerminalBackend` interface is the right seam to mock for multi-instance unit tests.** A `MockBackend` that records writes and fires onData/onExit on demand would let Phase 3 test isolation between two terminals without standing up two real shells. Don't widen the interface unless the view needs it — today's 6 methods are all in active use.
- **Backend errors render in the terminal pane**, not in modals. Reuse the `\r\n\x1b[31m[message]\x1b[0m\r\n` pattern when introducing new failure modes (profile not found, tmux session lost).
- **Shell detection in `TerminalView.detectShell()`** is the existing single hardcode point — replace it (or wrap it) when wiring the profile picker.

---

## Phase 3.5: Coverage + Showstopper Fixes (interstitial)

**Goal:** Fix the FI-007 keyboard regression that Phase 3's manual-test walkthrough surfaced (real-keyboard Ctrl-C and Cmd-P were both blocked by the terminal scope), close the test-coverage gap that let it hide behind green CI, and honestly re-verify MT-002. A tight bug-fix slice between Phase 3 and Phase 4 — not a feature phase. FI-002 was originally bundled in but closed as invalid mid-phase.

**Dependencies:** Phase 3 complete. Manual test findings recorded.

**Spec:** `specs/anvil/phase-3_5-coverage-and-showstoppers-spec.md`
**Completion report:** `specs/anvil/phase-3_5-coverage-and-showstoppers-completion.md`

**Success criteria:**
- Real-keyboard Ctrl-C reaches the PTY; Cmd-P opens Obsidian's command palette while the terminal is focused
- Existing `tests/e2e/keyboard-passthrough.e2e.ts` RED tests turn GREEN
- `tests/e2e/plugin.e2e.ts`'s "doesn't leak to Obsidian" test upgraded to a two-sided contract (also asserts xterm received the keydown)
- No regressions in the existing unit + e2e suites
- MT-002 honestly re-verified, original ⚠️ retroactively-invalid mark applied to the Phase 2b row
- `TerminalBackend` interface NOT widened

**Risk flags:**
- Asymmetric Cmd/Ctrl model is macOS-specific; documented as a constraint that FI-011 will need to redesign for Windows/Linux

---

## Phase 4: Settings, Polish + Distribution

**Goal:** Make the plugin installable and configurable. Settings UI (default shell, font size, theme, keybindings), Obsidian theme integration (light/dark), distribution packaging (GitHub release with bundled PTY backend), and edge case fixes from dogfooding.

**Dependencies:** Phase 3 complete. Dogfooding feedback collected.

**Success criteria:**
- Settings tab with user-configurable options
- Terminal theme follows Obsidian light/dark mode
- Installable from a GitHub release with no manual steps beyond plugin install
- PTY backend dependency handled automatically on first use
- No orphaned processes under any close/unload/quit scenario

**Risk flags:**
- Binary distribution through Obsidian's plugin ecosystem has no established pattern
- Obsidian version updates can break native module builds
- Community plugin review requirements (if pursued later)

### Notes from Phase 2b

- **Codesigning the binary is now blocking for distribution.** Phase 2b strips the macOS quarantine bit on the *repo's* copy of `bin/pty-server` at build time, but a downloaded GitHub release will get the bit re-attached. Phase 4 must either ship a signed/notarized binary or call out `xattr -d com.apple.quarantine` prominently in install docs.
- **`bin/pty-server` must travel with the release artifact.** Phase 2b learned the hard way that `obsidian-launcher` only copies `manifest.json`, `main.js`, `styles.css` — same pattern as Obsidian's own plugin install flow. The Phase 4 release packaging must bundle the `bin/` directory into the release zip and confirm Obsidian places it next to `main.js` after install. If it doesn't, the runtime spawn path needs a fallback.
- **Cargo Dependabot/Renovate.** Still not set up — flagged in 2a's notes, still not blocking. Worth bundling alongside the npm dependency hygiene work in Phase 4.
- **Theme integration.** xterm.js's theme is currently hardcoded to a near-transparent background and grey foreground. Phase 4 should read Obsidian CSS variables.
- **The `onResize` double-fit issue** flagged in Phase 1's notes is still unaddressed. Phase 2b explicitly left it alone per spec boundary; Phase 4 should clean it up.

### Notes from Phase 3

- **`preserveTmuxDimensions` setting is persisted but not yet consumed.** The setting round-trips through the settings UI and `saveData`, but `main.ts:openPicker`'s tmux attach case always passes `["attach-session", "-t", <name>]` without adjusting for `-x`/`-y`. This is a minor D3 gap. Phase 4 should wire the setting into the `shellArgs` construction, reading pane cols/rows off the host at launch time.
- **PtyBackend `shellArgs` login-flag interaction (Option A).** Caller-supplied `shellArgs` currently suppress the implicit `--shell-arg=-l` for zsh/bash. Flagged in-code. Revisit if any future caller needs login-shell + custom args simultaneously — may want an explicit `loginShell?: boolean` opt-in instead of "coupled to whether shellArgs was passed."
- **Dependency maintenance kickoff was skipped for Phase 3 per D12.** Phase 4 is the first hook point. Start Phase 4 with a Dependabot scan on `wdio-obsidian-service` and an Obsidian test-binary version audit against current stable.
- **Undocumented Obsidian APIs in production.** Three entry points rely on internal/undocumented API shape: `rootSplit.setDirection` + `workspace.createLeafInParent` (dock flip — already has a feature-detect fallback), and `SuggestModal.chooser.setSelectedItem` (default-shell pre-selection — no fallback, silently degrades to "arrow keys start at row 0"). Phase 4's dependency audit should re-verify these against whatever Obsidian version the test binary is pinned to.
- **D8 tab-group isolation passes with no isolation code.** `tests/e2e/tab-isolation.e2e.ts` covers the quick-switcher/Cmd-click/split/drop entry points by asserting the terminal's xterm `offsetParent !== null` after the operation. If a future Obsidian change hides leaves via `visibility: hidden` instead of `display: none`, the test could false-pass — worth a manual re-judge if a user reports a regression.
- **`usingFallback` flag on the bottom dock is unused.** `createBottomDock` exposes it but no caller reads it. Phase 4 polish could surface degraded-mode via the inline red ANSI pattern if that matters once real users are on it.
- **`TerminalBackend` interface was not widened.** Multi-instance + tmux shellArgs both landed without touching the 6-method contract. If Phase 4 adds theme-plumbed features that need per-view config, keep resisting the urge to widen — `TerminalView.setState`/`getState` with a typed launch spec is the working pattern.

### Notes from Phase 3.5

- **Documentation followup is owed.** The new asymmetric Cmd/Ctrl keyboard model in `TerminalView` (drop the Obsidian scope swallow, add a single container-level bubble-phase `keydown` listener that calls `stopPropagation()` only on `ctrlKey && !metaKey`) is the first non-trivial WHY in the codebase that isn't obvious from the code. Code comment is intentionally one short line; the full rationale, the bubble-vs-capture timing argument, and the macOS-only tradeoff want a real explanation doc when `/document` runs in Phase 4. Likely `docs/explanations/keyboard-handling.md`.
- **FI-011 (cross-platform) inherits this design directly.** The `containerKeydownHandler` is the right extension point for the recommended Option W-C ("commands to skip shell" list) — replace the hardcoded `ev.ctrlKey && !ev.metaKey` predicate with a configurable lookup, don't redesign the listener topology. The bubble-phase placement is what makes the asymmetric outcome possible.
- **MT-002 is now `⏳ pending user verification`.** Phase 4's manual sweep should close it out. The retroactive `⚠️ invalid` annotation on the original Phase 2b row is permanent — future readers need it to understand why a ✅ row exists for a test that didn't actually pass.
- **Reduced surface area in `TerminalView`.** The fix removed four private fields and ~30 lines of scope/focus machinery. If Phase 4 needs to add per-view keyboard config (theming hotkeys, FI-011 skip-list), keep resisting the urge to bring back a Scope-based mechanism — a single keydown handler with a predicate is the working pattern.
- **Dependency maintenance kickoff still belongs to Phase 4.** Per the spec's source notes, 3.5 explicitly did not pull this work forward.

---

## Verification

After each phase, the plugin should be testable by:
1. Building with the project's build command
2. Copying output to `~/.obsidian/plugins/anvil-obsidian-terminal/` (or symlinking during dev)
3. Enabling in Obsidian settings → Community plugins
4. Exercising the features added in that phase
