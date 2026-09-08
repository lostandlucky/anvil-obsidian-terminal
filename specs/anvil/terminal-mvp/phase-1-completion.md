# Phase 1 Complete: Plugin Scaffold + Terminal Rendering

**Mode:** Code Tests (Vitest unit + wdio e2e)
**Cycles:** 2 (GREEN on scaffold + mock REPL; 4 revisions on the hotkey guard test design before it was cleanly RED-verifiable)
**Status:** GREEN — 10 unit + 8 plugin e2e + 1 smoke e2e = **19 tests passing**

## Deliverables

- **manifest.json** — id `anvil-obsidian-terminal`, minAppVersion `1.5.0`, desktop-only
- **esbuild.config.mjs** — builds `main.js` (cjs, obsidian external) and `styles.css` (bundles `@xterm/xterm/css/xterm.css` + plugin rules)
- **src/main.ts** — `TerminalPlugin` registers the view + `open-terminal` command
- **src/view/TerminalView.ts** — `ItemView` subclass: mounts xterm, writes welcome, routes input through the mock REPL, manages the hotkey guard
- **src/terminal/xterm-host.ts** — xterm.js lifecycle (init, mount, write, ResizeObserver + FitAddon, dispose). No `obsidian` import.
- **src/terminal/mock-repl.ts** — pure command parser: `help`, `echo`, `clear`, `colors`, unknown. ANSI escapes in output. No `obsidian` import.
- **src/terminal/mock-repl.test.ts** — 10 vitest cases for the REPL
- **tests/e2e/plugin.e2e.ts** — 8 wdio tests against real Obsidian
- **wdio.conf.mts** — now includes `plugins: ["."]` so the harness installs the built plugin
- **package.json** — adds `obsidian 1.12.3`, `@xterm/xterm 6.0.0`, `@xterm/addon-fit 0.11.0`, `esbuild 0.28.0`, `builtin-modules 5.1.0` — all exact-pinned per audit condition 1

## New dependencies (exact pins)

| Package | Version | Role |
|---|---|---|
| `obsidian` | 1.12.3 | TypeScript types (dev) |
| `@xterm/xterm` | 6.0.0 | Terminal renderer |
| `@xterm/addon-fit` | 0.11.0 | Reflow to container |
| `esbuild` | 0.28.0 | Plugin bundler |
| `builtin-modules` | 5.1.0 | Node externals list |

## Test run

```
npm test
├─ vitest run   ✓ 10 passed (mock-repl + Phase 0 smoke)
└─ wdio run     ✓ 9 passed
   ├─ tests/e2e/plugin.e2e.ts  (8 passed)
   │   - loads as an enabled plugin
   │   - registers the open-terminal command
   │   - executing the command mounts xterm in an ItemView
   │   - shows the welcome message in the terminal buffer
   │   - typed input is echoed and the echo command prints its argument
   │   - ANSI colors render as styled spans, not raw escape codes
   │   - Ctrl-C dispatched inside the focused terminal does NOT leak to Obsidian
   │   - closing and reopening the terminal leaves no console errors
   └─ tests/e2e/smoke.e2e.ts (Phase 0 harness test, still green)
```

Full suite runtime: ~5s (after Obsidian binary cached).

## User testing

After `npm install && npm run build`, symlink or copy the plugin dir into a test vault (**not your real vault** — see caveat below) and reload the vault. Then:

1. **Open a terminal** — Cmd-P → "Open terminal". A pane should appear with a welcome banner ("Obsidian Terminal (mock REPL)") in cyan/yellow and a green `mock>` prompt.
2. **Type commands**:
   - `help` — lists the four commands with cyan headings
   - `echo hello world` — prints `hello world`
   - `colors` — prints `red green yellow bold-cyan`, each in the right color
   - `clear` — clears the screen and re-prints the prompt
   - `nope` — prints `unknown command: nope` in red
3. **Test hotkey capture** — with the terminal focused, press Cmd-P. The Obsidian command palette should NOT open. Click on any other pane, press Cmd-P — palette opens normally. Same for Cmd-K, Cmd-O, Ctrl-C, etc.
4. **Resize the pane** — drag the pane divider. Terminal text reflows, no overflow, no clipping.
5. **Move the pane** — drag the terminal tab to a new split position. It should either survive or cleanly reinitialize (close/reopen is also fine).
6. **Close and reopen** — close the pane, Cmd-P → "Open terminal". Should work with no console errors and a fresh welcome banner.

**Do NOT install into your real vault.** The plugin has only been validated against the fixture vault at `tests/e2e/fixtures/vault/`. Use a throwaway vault for manual testing.

## How the hotkey guard actually works

This took 4 iterations to get right. Notes for Phase 2+ in case the same issue resurfaces:

- A DOM `keydown` capture-phase listener on `document` or `window` does **not** run before Obsidian's hotkey handlers. Obsidian registers first at app init, and capture-phase listener order on the same target is registration order.
- Even stopping propagation at the capture phase is too late — Obsidian has already dispatched the command.
- The Obsidian-native fix is to push a `Scope` onto `app.keymap`. Scopes are checked top-down, newest first. Anything our scope "handles" (handler returns `false`) never reaches the base scope.
- A wildcard `register(null, null, ...)` is too broad — it swallows plain character keys too, because the Obsidian keymap dispatcher calls `preventDefault()` on handled events, which blocks the textarea from receiving text input.
- The working pattern: register only **modified** chord patterns (`Mod`, `Mod+Shift`, `Mod+Alt`, `Mod+Shift+Alt`, `Ctrl`, `Ctrl+Shift`, `Ctrl+Alt`, `Alt`), wildcard key. Plain typing (`e`, `c`, `h`, `o`, etc.) isn't touched, so xterm still gets it.
- Scope is pushed on container `focusin` and popped on `focusout` (only when focus moves outside the container).

## RED/GREEN notes

The Ctrl-C hotkey guard test had three failed attempts before settling on one that was actually RED-verifiable:

1. **`browser.keys(["Control", "p"])`** — didn't reach Obsidian's keymap at all. Passed trivially whether the guard existed or not. Deleted.
2. **Synthetic `Cmd-P` via `dispatchEvent`** — Obsidian's Cmd-P handler seems to require specific event state (native menu interaction? editor scope?) that synthetic events don't satisfy. The negative test passed even with the guard removed. Deleted.
3. **Scope-on-keymap-stack introspection** — `app.keymap.scope` differs from `app.scope` even without our push (editors push their own scopes). False positive. Deleted.
4. **Ctrl-C synthetic dispatch + document-level probe** — clean: when the guard is on, the probe never fires; when the guard is off, it does. RED-verified and kept.

The positive control (`Cmd-P on document with no terminal open → palette opens`) stays as a sanity check that synthetic dispatch works in the clean state.

## Notes for downstream phases

- **Phase 2 needs to replace `handleInput`.** The mock REPL interpreter in `TerminalView.handleInput` is directly inlined. Phase 2 should swap it for a PTY backend behind an interface so the view doesn't know whether it's talking to a mock or a real shell. Expected location: `src/pty/` with a small `TerminalBackend` interface (`write`, `onData`, `resize`, `close`).
- **The hotkey guard is load-bearing** and should not be removed or weakened in Phase 2. Real shells will need Ctrl-C, Ctrl-Z, Ctrl-D etc. to reach the PTY — those go through xterm's textarea, which already works. The Obsidian Scope only blocks hotkey actions, not text input.
- **Scope registration list is not exhaustive.** If a user binds a plain-key hotkey (e.g. `F6` → command palette), our guard won't block it. Covering every possible modifier combo wasn't worth the complexity for Phase 1. If it becomes an issue, iterate.
- **No multi-instance isolation yet.** Each `TerminalView` creates its own `Scope`, but they all register the same chord set. Pushing two scopes is fine — innermost wins — but if Phase 3 adds multi-instance it should verify no scope leaks on view detach.
- **`onResize()` calls `host.fit()`**, but also `ResizeObserver` inside `createXtermHost` observes the container. Two paths to reflow — both work, pick one in a later pass if it causes double-fit pauses.
- **Styles build uses esbuild's CSS bundler** to inline `@xterm/xterm/css/xterm.css` into `styles.css`. If the output size becomes a concern, switch to referencing xterm's CSS via a `<link>` tag injected at plugin load.
- **The `main.js` bundle is ~340KB.** That's xterm.js + fit addon; no minification beyond esbuild's default. Phase 4 (polish + dist) may want to trim.
- **Obsidian pin stays at 1.12.7 test binary / 1.12.3 types.** Phase 0's monthly-cadence check applies at Phase 2 kickoff per `CLAUDE.md` — revisit then, not now.
- **Phase 0 audit conditions all preserved**: exact pins ✓, no Insider mode ✓, project-local `.obsidian-cache` ✓, re-audit on Dependabot bumps (unchanged, no bumps yet).
