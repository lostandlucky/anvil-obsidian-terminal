# Testing Approach

Reference for how this project is tested across all phases. Read this before writing tests in any phase spec.

## Principles

1. **Real Obsidian is the truth.** A test that proves the plugin works inside a real, running Obsidian instance beats any amount of mocked-out unit coverage. Default to e2e for anything that touches the plugin surface.
2. **Pure logic is separable.** Terminal mock REPL parsing, shell discovery rules, tmux session parsing, theme resolution — these should live in modules that don't import from `obsidian`. They get fast unit tests.
3. **Tests are the verification mechanism for phase completion.** Every phase's acceptance criteria should map to a test (unit, e2e, or — last resort — a named manual step). No "trust me it works."
4. **The e2e harness is infrastructure.** Built once in Phase 1, paid down across every subsequent phase. Don't cut corners on it.

## Three Test Levels

### Level 1: Unit tests (pure logic)

**Runner:** Vitest (fast, TS-native, plays well with esbuild).

**What goes here:**
- Mock REPL command parsing and output formatting
- ANSI escape sequence generation helpers
- Shell profile discovery logic (parse `/etc/shells`, filter, dedupe)
- tmux `list-sessions` output parser
- Any pure function that takes input and returns output

**What does NOT go here:**
- Anything that imports from `obsidian`
- Anything that touches the DOM
- Anything that requires an ItemView, Workspace, or Plugin instance

**Rule:** If you're tempted to mock `obsidian`, stop — that test belongs at Level 2.

**Location:** `src/**/*.test.ts` colocated with source, or `tests/unit/` if it gets unwieldy.

### Level 2: E2E tests (real Obsidian)

**Runner:** WebdriverIO + [`wdio-obsidian-service`](https://forum.obsidian.md/t/package-for-end-to-end-testing-obsidian-plugins/98645).

**How it works:** wdio-obsidian-service downloads a sandboxed Obsidian binary, installs the plugin into a fixture vault, launches Obsidian via Electron, and hands WebdriverIO full control of the renderer. You can query the DOM, send keystrokes, execute commands, inspect the console, and call Obsidian's internal APIs via `browser.execute`.

**Harness provenance — read before adopting.** `wdio-obsidian-service` is **not an Obsidian-official package**. npm registry as of adoption:

- Single maintainer (`jesse-r-s-hines`), first published Feb 2025.
- Repo: `github.com/jesse-r-s-hines/wdio-obsidian-service`.
- Linked from a community forum thread, not Obsidian's own docs.

This is the best option in a thin field, but it's solo-maintained community tooling. Implications the project accepts:
- **Bus factor of one.** If upstream stalls, this project owns its e2e infra.
- **Runs in the test env with filesystem + network access** (it downloads an Obsidian binary). A source audit happens in Phase 0 before adoption, not after.
- **Obsidian updates may break it.** The fix is on us, not upstream.

**Version pinning is mandatory.** Both the npm package AND the Obsidian test binary are pinned to exact versions — not semver ranges. This is for reproducibility (fresh clones and CI runs get identical bytes), not to freeze in place. Upgrades arrive as Dependabot/Renovate PRs and are reviewed deliberately. See `CLAUDE.md` → "Dependency Maintenance" for the cadence (check each phase start; minimum monthly; flag if stale >6 weeks). Aim to stay within ~1 minor version of current Obsidian stable, lagging slightly is fine and often more representative of what users run.

**Fallback if the harness fails to stand up.** If the Phase 0 spike can't get a trivial "open Obsidian, assert workspace loaded, quit" test green within its time box, the project falls back to: Vitest unit coverage + a documented manual checklist for e2e-shaped acceptance criteria, with e2e revisited in Phase 2 alongside the PTY work. This decision is pre-made so it isn't negotiated under pressure at hour six of debugging Chromedriver.

**What goes here:**
- Command palette registration ("Open terminal" exists and fires)
- View rendering (xterm mounts, cursor visible, ANSI colors render as styled spans)
- Keystroke capture (Ctrl-C/P/K don't leak to Obsidian hotkeys)
- Layout survival (close/reopen, pane splits, reload)
- PTY integration (real shell output appears in the terminal, interactive programs work)
- Profile picker (modal opens, lists discovered shells/sessions, selection launches correct target)
- Multi-instance behavior
- Settings UI (changes take effect, persistence works)
- Process cleanup (no orphaned shells after close/unload)

**Tricky bits:**
- **Drag-and-drop** is historically flaky in Electron. Don't drive pane moves via pointer events — call `app.workspace.moveLeafToPopout()` / `splitActiveLeaf()` through `browser.execute` instead. The goal is "the view survives being moved," not "WebdriverIO can drag."
- **Keyboard focus** before sending keys. Always click the terminal first, or explicitly focus the xterm textarea.
- **Async settling.** Obsidian's layout ops are async. Use `browser.waitUntil` with explicit DOM predicates rather than arbitrary sleeps.

**Fixture vault:** A minimal vault at `tests/e2e/fixtures/vault/` — empty except for what a given test needs. Reset between tests via `beforeEach`.

**Location:** `tests/e2e/*.spec.ts`.

### Level 3: Manual verification (last resort)

Some things genuinely cannot be asserted by a test runner. Keep this list short and justified.

**Candidates:**
- Visual theme integration (does it look right in light/dark modes — subjective)
- First-launch install UX (does the PTY backend bootstrap feel acceptable)
- Long-running stability (leaks, process accumulation over an hours-long session)

**Format:** Each phase spec's "User Testing" section. Each item must name a concrete action, the expected observation, and why it can't be automated. If you can't justify the "why," move it to Level 2.

## Tooling Summary

| Purpose | Tool | Install |
|---|---|---|
| Unit tests | Vitest | `vitest` |
| E2E framework | WebdriverIO | `@wdio/cli` + standard wdio deps |
| E2E Obsidian integration | wdio-obsidian-service | `wdio-obsidian-service` |
| Build (prod + test bundles) | esbuild | Already the Obsidian plugin default |
| Assertion library | WebdriverIO built-in (`expect-webdriverio`) + Vitest's `expect` | Bundled |

One test command to rule them all: `npm test` runs unit then e2e. `npm run test:unit` and `npm run test:e2e` for isolation.

## Code Structure for Testability

Follow the Obsidian community convention: keep the `Plugin` class thin, push logic into pure modules.

```
src/
  main.ts              ← Plugin subclass. Registers commands, views, settings. Glue only.
  view/
    TerminalView.ts    ← ItemView subclass. Wires xterm to a backend. Thin.
  terminal/
    xterm-host.ts      ← xterm.js lifecycle (init, dispose, resize, write). No obsidian import.
    mock-repl.ts       ← Pure command parser. Unit tested.
  pty/                 ← Phase 2+. Backend-specific modules, kept behind an interface.
  profiles/            ← Phase 3+. Discovery logic, pure.
  settings/            ← Phase 4+.
tests/
  unit/                ← Or colocated as *.test.ts next to source.
  e2e/
    fixtures/vault/
    *.spec.ts
```

The boundary rule: a file imports from `obsidian` **or** it has unit tests. Not both. If you need both, the file is doing too much — split it.

## RED/GREEN Discipline

Per `/phase-exec`, every test must be seen failing before it's made to pass.

- Write the test.
- Run it. Confirm it fails **for the right reason** — the feature doesn't exist, not a typo in an import.
- Implement the minimum to make it pass.
- Commit on green.
- Next test.

A test that passes on the first run is suspicious. Either the feature was already done (fine — move on) or the test isn't testing what you think.

## Per-Phase Mapping

Rough guidance — each phase spec should still pick explicitly.

| Phase | Unit | E2E | Manual |
|---|---|---|---|
| 1 — Scaffold + xterm | Mock REPL parser | Command registered, view renders, keystrokes captured, reflow, close/reopen, no console errors | Visual theme sanity |
| 2 — PTY backend | Parsing of backend handshake / messages if any | Real shell output, ANSI, Ctrl-C interrupt, vim opens, resize SIGWINCH reflows, clean kill on close | First-launch backend install UX |
| 3 — Profiles + sessions + multi | Shell discovery, tmux parser | Picker modal contents, launch flow per profile type, multi-instance isolation, tmux absent fallback | — |
| 4 — Settings + polish + dist | Settings serialization | Settings UI round-trip, theme switching, no orphans after unload | Long-running stability, install-from-release UX |

## What NOT To Do

- **Don't mock `obsidian`.** If you're reaching for a mock, the code belongs behind a boundary that doesn't need one.
- **Don't write tests that only assert internal call shapes** ("called `registerView` with these args"). Assert outcomes — the view opens, the command runs, the output appears.
- **Don't skip e2e because it's slow.** It's slow. Run it anyway. That's what `npm run test:unit` is for during the inner loop.
- **Don't pile manual steps into the User Testing section to avoid writing tests.** Every manual step is a regression waiting to happen. Justify each one.
- **Don't let the fixture vault accumulate cruft.** Reset between tests. A dirty fixture is a flaky test.

## References

- [wdio-obsidian-service (forum thread)](https://forum.obsidian.md/t/package-for-end-to-end-testing-obsidian-plugins/98645)
- [How to add automated tests to your plugin — Obsidian Hub](https://publish.obsidian.md/hub/04+-+Guides,+Workflows,+&+Courses/Guides/How+to+add+automated+tests+to+your+plugin)
- [How to test plugin code that uses Obsidian APIs — Obsidian Hub](https://publish.obsidian.md/hub/04+-+Guides,+Workflows,+&+Courses/Guides/How+to+test+plugin+code+that+uses+Obsidian+APIs)
- [Standard approach for writing automated end-to-end tests for plugins (forum)](https://forum.obsidian.md/t/standard-approach-for-writing-automated-end-to-end-tests-for-plugins/31535)
- [Integration Testing in Obsidian (dev.to)](https://dev.to/bcamphart/integration-testing-in-obsidian-1gm5)
- [obsimian — simulation framework (alternative we rejected for unit-only scope)](https://github.com/motif-software/obsimian)
- [jest-environment-obsidian (alternative we rejected — unit shim only)](https://github.com/obsidian-community/jest-environment-obsidian)
