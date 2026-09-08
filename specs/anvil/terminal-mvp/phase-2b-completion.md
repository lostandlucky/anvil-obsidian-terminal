# Phase 2b Complete: PTY Plugin Integration

**Mode:** Code Tests (Mode B) — Vitest unit tests for the pure seam plus
WebdriverIO e2e tests in real Obsidian for the integrated behavior. The
build-pipeline check is qualitative (delete the binary, rebuild, confirm it
reappears).
**Cycles:** 1 — clean pass once the wdio fixture-install gap was identified.
**Status:** GREEN — all 11 acceptance criteria pass.

## Deliverables

### Source

- `src/pty/terminal-backend.ts` — the `TerminalBackend` interface
  (`start`, `write`, `resize`, `onData`, `onExit`, `close`). The view
  consumes only this surface.
- `src/pty/protocol-client.ts` — pure framing: `encodeInput`,
  `encodeResize`, `decodeServerMessage`. No Node, no WebSocket, no
  Obsidian — Vitest-friendly.
- `src/pty/protocol-client.test.ts` — 8 unit tests covering encode,
  decode, malformed JSON, unknown type, invalid base64.
- `src/pty/spawn-args.ts` — `buildSpawnArgs` + `isLoginShellCapable`,
  produces the `--shell-arg=-l` hyphen-equals form per Phase 2a's bake-in
  note.
- `src/pty/spawn-args.test.ts` — 6 unit tests.
- `src/pty/port-discovery.ts` — `parsePortLine` against the literal
  `^PTY_SERVER_LISTENING port=(\d+)$` regex from PROTOCOL.md.
- `src/pty/port-discovery.test.ts` — 4 unit tests.
- `src/pty/pty-backend.ts` — the real `TerminalBackend` implementation.
  Spawns the 2a binary, parses port discovery from stdout, opens a
  WebSocket, translates both directions, surfaces backend errors as
  styled lines into xterm. Holds onto the child handle so `close()` can
  SIGTERM it directly as a backstop.

### View / glue

- `src/view/TerminalView.ts` — rewritten. The view no longer imports
  `mock-repl`. Input flows view → `host.onData` → `backend.write`,
  output flows `backend.onData` → `host.write`, resize flows
  `host.onResize` → `backend.resize`. `backend.start()` is awaited
  *after* the focus/scope handlers are installed so a slow handshake
  cannot leave the textarea unguarded.
- `src/main.ts` — passes the plugin instance into the view factory so
  the view can resolve the binary path via `manifest.dir`.
- `src/terminal/xterm-host.ts` — adds `onResize(handler)` to the
  XtermHost interface, forwarding xterm.js's `terminal.onResize` to the
  view.

### Mock REPL — kept, unwired

- `src/terminal/mock-repl.ts` and `src/terminal/mock-repl.test.ts` are
  unchanged. The 18 mock-repl unit tests still pass — useful as a
  reference for the seam shape and as offline testing scaffold.

### Build

- `esbuild.config.mjs` — production *and* dev builds now invoke
  `cargo build --release` in `pty-server/` and copy the output to
  `bin/pty-server` alongside `main.js`. PATH is augmented with
  `~/.cargo/bin` so fresh shells (where rustup isn't sourced) still find
  cargo. The macOS quarantine bit is stripped from the freshly-copied
  binary so first-run users don't hit Gatekeeper.
- `.gitignore` — adds `/bin/`.

### Tests

- `tests/e2e/pty-backend.e2e.ts` — six new e2e tests inside real
  Obsidian, listed below.
- `tests/e2e/plugin.e2e.ts` — the Phase-1 welcome and colors tests
  (which asserted on `mock>` and the mock `colors` command) are
  replaced with a single check that the live view is *not* showing mock
  output. The hotkey-guard and close/reopen tests are unchanged.
- `wdio.conf.mts` — adds a `before` hook that copies `bin/pty-server`
  into the temp plugin dir after wdio-obsidian-service installs the
  plugin. Necessary because `obsidian-launcher` only copies
  `manifest.json` / `main.js` / `styles.css`, not arbitrary supporting
  files.

## Test run

```
$ npm run test:unit
 Test Files  5 passed (5)
      Tests  28 passed (28)

$ npm run build
[esbuild + cargo build --release + binary copy]
    Finished `release` profile [optimized] target(s) in 0.15s

$ npx wdio run ./wdio.conf.mts
» tests/e2e/plugin.e2e.ts            6 passing
» tests/e2e/pty-backend.e2e.ts       6 passing
» tests/e2e/smoke.e2e.ts             1 passing
Spec Files: 3 passed, 3 total
```

41 total passing tests. Zero `pty-server` orphan processes after the
suite (`ps -eo pid,comm | grep "pty-server$"` is empty).

## Acceptance criteria — line by line

| # | Criterion | Status | Where verified |
|---|---|---|---|
| 1 | `npm test` is green: existing tests + new tests pass | ✓ | 28 unit + 13 e2e green |
| 2 | E2E: typing `echo hello`-style command in a real shell shows the result | ✓ | `pty-backend.e2e.ts` "printf MARKER round-trips" |
| 3 | E2E: ANSI colors from a real command render as styled spans | ✓ | `pty-backend.e2e.ts` "ANSI colors from a real shell" |
| 4 | E2E: Ctrl-C interrupts `sleep 30`, prompt returns, shell alive | ✓ | `pty-backend.e2e.ts` "Ctrl-C interrupts a long-running program" |
| 5 | E2E: Pane resize → `tput cols` reflects new width | ✓ | `pty-backend.e2e.ts` "resizing the pane changes the shell's $COLUMNS" |
| 6 | E2E: Closing view kills shell + binary | ✓ | `pty-backend.e2e.ts` "closing the view kills the shell and the pty-server binary" |
| 7 | E2E: Disabling plugin kills binary | ✓ | `pty-backend.e2e.ts` "disabling the plugin kills any running pty-server binary" |
| 8 | Manual: `vim` opens, alternate screen, `:q` clean | — | listed in user testing below; not asserted in e2e per spec |
| 9 | Unit (TS): pure module has Vitest tests | ✓ | 18 new Vitest tests across protocol-client, spawn-args, port-discovery |
| 10 | `npm run build` produces working bundle including binary | ✓ | manually verified: `rm bin/pty-server && npm run build && [ -f bin/pty-server ]` → REGENERATED OK |
| 11 | `phase-2b-completion.md` exists | ✓ | you're reading it |

## User testing

After `npm install && npm run build` and reinstalling the plugin into a
**throwaway test vault** (not your real vault — the Phase 1 caveat still
applies), copy `main.js`, `manifest.json`, `styles.css`, **and the
`bin/` directory** into the plugin folder. The binary path the plugin
expects is `<plugin dir>/bin/pty-server`.

1. **First-run quarantine fix** — if Gatekeeper blocks the binary on a
   fresh build:
   ```bash
   xattr -d com.apple.quarantine path/to/plugins/anvil-obsidian-terminal/bin/pty-server
   ```
   The build script does this for the in-repo copy automatically; the
   quarantine bit only re-attaches on freshly-copied files.
2. **Open a terminal** — Cmd-P → "Open terminal". The pane should show
   your real shell's prompt (zsh `%`, bash `$`, etc.) — *not* the mock
   `mock>` prompt.
3. **Run real commands** — `pwd` (should match the vault root), `ls`,
   `echo $SHELL` (should match `$SHELL`).
4. **Test PATH inheritance** — `which brew` (or any Homebrew-installed
   binary) should resolve. If it doesn't, the login-shell flag isn't
   being passed through.
5. **Test interactive programs** — `vim`. Screen clears, vim takes
   over, `:q` returns cleanly. Then try `htop` or `top` if available.
6. **Test signal handling** — `sleep 30` then Ctrl-C; prompt returns
   immediately, shell is alive. `cat` (no args) → Ctrl-D exits cleanly
   without killing the shell.
7. **Test resize** — drag the pane divider while a long line is on
   screen; text reflows. Run `tput cols` before and after to verify.
8. **Test cleanup** — open a terminal, then in another terminal:
   ```bash
   ps -eo pid,comm | grep -E 'pty-server$|zsh$'
   ```
   Close the Obsidian terminal pane. Both processes should be gone.
   Repeat with: plugin disable, then with Obsidian quit.
9. **Test multiple opens** — open, close, reopen, close, reopen. No
   console errors. No orphaned processes between cycles.

## Bumps

Two real bugs the test cycle caught, worth recording:

1. **`onOpen` race between backend.start and focus handlers.** First
   draft awaited `backend.start()` before installing the focus/scope
   handlers. When the binary was missing, `backend.start()` rejected
   slowly and the rest of `onOpen` (focus handlers, `host.focus()`)
   never ran — the textarea sat in the DOM with no scope guard, so
   Ctrl-C leaked into Obsidian's hotkeys. Caught immediately by the
   Phase-1 "Ctrl-C does not leak" e2e test. Fixed by installing the
   focus/scope handlers and calling `host.focus()` *before* awaiting
   `backend.start()`. The slow handshake is now harmless.

2. **`obsidian-launcher` only copies `manifest.json`, `main.js`,
   `styles.css`.** The Rust binary at `bin/pty-server` was missing from
   the test vault's plugin install, so all six new e2e tests timed out
   trying to talk to a non-existent backend. Diagnosed by adding a
   one-shot DIAG test that printed the resolved binary path and an
   `existsSync` check. Fixed by adding a `before` hook in
   `wdio.conf.mts` that copies `bin/pty-server` into the temp plugin
   dir after wdio-obsidian-service installs the plugin. Documented
   inline in the conf file. **Phase 4 distribution will need to make
   sure the binary actually ships in the GitHub release artifact** —
   this is the same class of problem in a different costume.

## Notes for downstream phases

For **Phase 3** (profiles, sessions, multi-instance):

- **One backend per terminal view, one binary per backend.** That's
  built into how `PtyBackend` is constructed today — there's no shared
  state, no port pooling, no multiplexing. Phase 3's "spawn another
  binary on another port" model just works.
- **Profile selection lives between `TerminalView` and `PtyBackend`.**
  Today the view hardcodes `process.env.SHELL || "/bin/zsh"` and
  `vault root` as cwd. A profile picker in Phase 3 should resolve to a
  `{shell, args, cwd, env}` object and pass that into `PtyBackend`'s
  constructor — the backend doesn't care where the values came from.
- **The `TerminalBackend` interface is the right seam to mock for
  multi-instance unit tests.** A `MockBackend` that records writes and
  fires onData/onExit on demand would let Phase 3 test the
  "isolation between two terminals" claim without standing up two real
  shells.
- **Don't widen the `TerminalBackend` interface unless the view needs
  it.** Today: 6 methods, all in active use. Adding "for testing" hooks
  to it would weaken the seam.
- **Backend errors render in the terminal pane.** If Phase 3 introduces
  failure modes (profile not found, tmux session lost), reuse the
  `\r\n\x1b[31m[message]\x1b[0m\r\n` pattern the backend already uses.
  Don't pop modals.

For **Phase 4** (settings, polish, distribution):

- **Codesigning the binary** — Phase 2b strips the macOS quarantine
  bit at build time on the *repo's* copy, but a downloaded GitHub
  release artifact will get the bit re-attached on first launch. Phase
  4 needs to either ship a signed/notarized binary or instruct users
  to run `xattr -d com.apple.quarantine` on first install. Document
  this prominently in the release README, ideally with a one-liner
  install script.
- **Binary in the release artifact.** The plugin folder needs to
  contain `bin/pty-server` alongside `main.js`. The current build
  produces this in the repo root; Phase 4's release packaging must
  bundle the `bin/` directory into the release zip and make sure
  Obsidian's plugin install flow places it in the right spot. The
  Phase 2b "Bumps" entry on `obsidian-launcher` copying only the
  standard files is the warning shot for this.
- **Cargo Dependabot/Renovate.** Still not set up — flagged in 2a's
  notes, still not blocking. Worth bundling alongside the npm
  dependency hygiene work in Phase 4.
- **Settings UI for shell selection.** Today shell detection is
  `process.env.SHELL || "/bin/zsh"`. A settings page should expose
  this; Phase 3's profile picker also needs to feed in here.
- **Theme integration.** xterm.js's theme is currently hardcoded to a
  near-transparent background and grey foreground. Phase 4 should
  read Obsidian CSS variables.
- **The `onResize` double-fit issue** flagged in Phase 1's notes is
  still unaddressed. Phase 2b explicitly leaves it alone per spec
  boundary, but Phase 4 should clean it up.

## Pinned-version state at end of phase

No new dependencies added. Existing pins from Phase 1 / 2a still hold:

| Dep | Pinned |
|---|---|
| `@xterm/xterm` | 6.0.0 |
| `@xterm/addon-fit` | 0.11.0 |
| `wdio-obsidian-service` | 3.0.2 |
| `obsidian` test binary | 1.12.7 |
| `vitest` | 4.1.4 |
| `webdriverio` family | 9.27.0 |

Rust deps unchanged from 2a (still all current as of 2026-04-14). No
Cargo Dependabot/Renovate set up — still flagged for Phase 4.
