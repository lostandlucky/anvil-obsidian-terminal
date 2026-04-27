# Phase Spec: Phase 3 — Release-readiness

## Objective

A real human can install this plugin from a GitHub link and use it without dev-env knowledge. The phase has two halves run in sequence: first FI-018 (process hygiene audit) covering force-quit, plugin reload mid-session, Obsidian crash, `pty-server` crash, hung shells, and multi-terminal abnormal exits — fix what's fixable, document what's not — then FI-017 (release packaging) producing a locally-built, locally-tagged macOS arm64 release zip with the install pattern documented honestly. **The phase explicitly does NOT push** any tags, branches, or release artifacts to GitHub. Publication is a manual step Steve takes after the morning audit.

## Decisions for Review

These need a resolution before exec proceeds. Auto-resolved per the overnight orchestrator's policy.

### D1: Codesigning vs. documented `xattr` workaround

The macOS quarantine bit (`com.apple.quarantine`) is set on any binary downloaded from the internet, including a `pty-server` binary inside a GitHub release zip. Three paths.

| Option | Notes |
|---|---|
| Codesign + notarize with Apple Developer ID | Best UX. Zero install friction. Requires an Apple Developer account ($99/yr) and a notarization pipeline (`codesign`, `notarytool`, stapling). Steve hasn't confirmed he has one. |
| Document the `xattr -d com.apple.quarantine` workaround | Worst UX. User runs one shell command after install. Clearly tells the user what's happening. Costs zero. |
| Auto-strip quarantine bit on plugin first-run | Gray-area. Plugin would shell out to `xattr -d` against its own embedded binary on first PTY spawn. Works without user action but feels like "the plugin is doing something to its own binary at runtime." |

**[RESOLVED]** — **Document the `xattr` workaround.** Steve doesn't have an Apple Developer account in this codebase's known state; codesigning is a separate setup project. Auto-stripping at runtime works but obscures the security model from the user — better to be honest. The install docs (README + a new `docs/install.md`) carry the workaround prominently with one-line command + explanation. Ship a `release.sh` script that produces the zip; codesigning hooks land as a TODO in `release.sh` for the day Steve gets a Developer account, but are not blocking this phase.

### D2: Bundle layout — does `bin/` travel with the release?

Phase 2b notes flagged this: `obsidian-launcher` and Obsidian's own plugin install path may copy only `manifest.json`, `main.js`, `styles.css` — not the `bin/` directory. Two approaches.

| Option | Notes |
|---|---|
| Ship `bin/pty-server` in the release zip, document the manual placement | Smaller-blast-radius first iteration. User unzips into the plugin folder; `bin/` lands alongside `main.js`. Works *if* user's unzipper preserves the directory. Some unzippers flatten. |
| Runtime fetch / extract fallback | Plugin checks for `bin/pty-server` at startup; if missing, downloads from the GitHub release. Solves flattening but adds a network dependency and an attack surface (plugin downloads + executes a binary). |
| Inline the binary in `main.js` as base64, decode + chmod on first run | One-file install. Bloats `main.js` by ~4MB. Awkward to update. Low recommend. |

**[RESOLVED]** — **Ship `bin/pty-server` in the release zip; verify the directory layout in a repeatable test before shipping.** Document the install steps explicitly: "unzip into your vault's `.obsidian/plugins/anvil-obsidian-terminal/` folder; the structure should match the layout in this README." Add a startup-time check: if `bin/pty-server` is missing on plugin enable, surface a clear in-app notice with the install-doc link rather than crashing. Runtime fetch fallback is deferred — too much surface area for the first release. The startup-check failure path counts as the "fallback" the meta-plan called for.

### D3: Hygiene-audit scope and automation split

FI-018 lists six scenarios. Some are e2e-automatable in WebdriverIO; some need a real OS / real `kill -9` and belong in the manual-test checklist.

**[RESOLVED]** — Categorize and ship as follows:
- **Automatable in e2e:** plugin reload mid-session (disable + re-enable plugin), multi-terminal abnormal exit (one tab's shell exits unexpectedly while siblings keep running), close-while-active (close a tab during heavy output).
- **Automatable in unit:** the cleanup callbacks themselves (does `dispose()` on a `PtyBackend` actually call `process.kill`? does `BinaryClient` close its websocket?).
- **Manual-only:** Obsidian force-quit, OS-level kill of `pty-server` PID, hung shell that won't respond to SIGTERM, Obsidian crash recovery. Each gets a `manual-test-checklist.md` entry under a new "Phase 3 — process hygiene" section.

Each automatable scenario gets an e2e or unit test; each manual scenario gets a checklist row with explicit reproduction steps. **Any leak discovered that costs > 1 day to fix is recorded as a known-limitation FI** rather than fixed in this phase — the meta-plan explicitly authorizes this offramp.

### D4: Release artifact name + version tag format

| Option | Notes |
|---|---|
| `anvil-obsidian-terminal-vX.Y.Z.zip`, tag `vX.Y.Z` | Standard. Matches `manifest.json` `version` field. |
| Versionless artifact, tag-only | Simpler for cycling pre-releases. Loses self-describing zip filename. |

**[RESOLVED]** — Use `anvil-obsidian-terminal-vX.Y.Z.zip` and tag `vX.Y.Z`. Read the version from `manifest.json` (currently `0.1.0`); the release script bumps `manifest.json` `version` field if `--version <X.Y.Z>` is passed, otherwise uses the current value. Version tag is created locally, not pushed.

## Requirements

### Hygiene-audit (FI-018) — runs first

- **R1.** Each automatable hygiene scenario per D3 has either a unit test (for the cleanup callback) or an e2e test (for the user-observable behavior). The full set: plugin reload mid-session, multi-terminal abnormal exit, close-while-active, `PtyBackend.dispose()` actually kills the process, `BinaryClient` closes its websocket on dispose.
- **R2.** Each manual-only scenario per D3 has a row in `specs/anvil/manual-test-checklist.md` under a new "Phase 3 — process hygiene" section, with explicit reproduction steps and the "what to look for" outcome.
- **R3.** Any leak discovered during the audit that is fixable in <1 day of work is fixed; any leak costing more is recorded as a known-limitation FI in `specs/anvil/future-ideas-backlog.md` with a clear repro and mitigation.
- **R4.** The audit itself produces a written summary table in the completion report listing each scenario, its automation level, the verdict (clean / leaked-and-fixed / leaked-and-deferred), and the issue ID for any leak deferred to FI.

### Release packaging (FI-017) — runs second

- **R5.** A `release.sh` script (in repo root or `scripts/`) builds a fresh production bundle, packages `manifest.json` + `main.js` + `styles.css` + `bin/pty-server` into `anvil-obsidian-terminal-v<version>.zip`, prints the SHA256 of the zip, creates a local git tag `v<version>`, and **does not push anything**. The script accepts `--version <X.Y.Z>` to bump `manifest.json` first.
- **R6.** A test (unit or shell) asserts the produced zip contains exactly the four files in the layout the docs claim, with `bin/pty-server` executable.
- **R7.** A startup-time check in `main.ts` (in `onload`) verifies `bin/pty-server` exists relative to the plugin path. If missing, surface a clear notice (Obsidian `Notice` API + `console.error`) pointing at the install-docs URL rather than crashing on first PTY spawn.
- **R8.** Install documentation lives at `docs/install.md` (new file). It walks a non-developer through: download release zip from GitHub, unzip into `.obsidian/plugins/anvil-obsidian-terminal/`, verify the bundle layout, run `xattr -d com.apple.quarantine bin/pty-server`, enable the plugin in Obsidian. Each step has its expected outcome.
- **R9.** README is updated with a one-paragraph "Install (release)" section linking to `docs/install.md`. The existing dev-install instructions stay (they're for contributors).
- **R10.** The Cargo dependency state is reviewed against any pending Dependabot bumps (per Phase 1's downstream note about the Cargo entry first-PR check). If bumps are pending, decide hold-or-bump-and-record the rationale in the completion report.
- **R11.** A version tag exists locally on the yolo branch's HEAD: `v0.1.0` (or whatever `manifest.json` says). **No `git push` is run.**

### Cross-cutting

- **R12.** Build still passes: `npm run build`, `npm run test:unit`, `npm run test:e2e`, `cargo build --release`.
- **R13.** No widening of `TerminalBackend` (multi-phase invariant). No edits to deployed `styles.css` (must edit `src/styles.css` source).
- **R14.** `pty-server` Cargo Dependabot from Phase 1 has run at least once OR is recorded as "not yet exercised" (per Phase 1's downstream note).

## Acceptance Criteria

### Hygiene half

- **AC1.** Plugin reload mid-session: an e2e test enables the plugin, opens a terminal with an active shell, disables the plugin, asserts the shell PID is no longer alive, re-enables the plugin, asserts a new terminal can be opened.
- **AC2.** Multi-terminal abnormal exit: an e2e test opens two terminals; one's shell is forcibly exited (via `exit 1` keystrokes); the other terminal continues to function.
- **AC3.** Close-while-active: an e2e test opens a terminal, runs a command emitting continuous output, closes the tab, asserts the shell PID is dead within 1 second.
- **AC4.** Unit tests cover `PtyBackend.dispose()` and `BinaryClient.close()` lifecycle: dispose calls process.kill (or equivalent), websocket gets closed, no double-dispose throws.
- **AC5.** `manual-test-checklist.md` has new "Phase 3 — process hygiene" section with rows for: Obsidian force-quit, OS-level kill of `pty-server` PID, hung shell that won't respond to SIGTERM, Obsidian crash recovery. Each row has reproduction steps + what-to-look-for.
- **AC6.** The completion report has an audit-summary table listing each scenario, automation level, verdict, FI reference (if leaked-and-deferred).

### Release half

- **AC7.** `release.sh` (or `scripts/release.sh`) exists, executable, produces `anvil-obsidian-terminal-v<version>.zip` from a clean build, prints SHA256, creates local tag, does not push.
- **AC8.** A test asserts the zip layout: top-level entries are exactly `manifest.json`, `main.js`, `styles.css`, `bin/pty-server`; `bin/pty-server` has the executable bit set.
- **AC9.** Plugin `onload` surfaces a clear notice if `bin/pty-server` is missing, with the install-docs link, instead of crashing.
- **AC10.** `docs/install.md` exists with the full install walkthrough including the `xattr` step.
- **AC11.** README has the "Install (release)" section linking to install.md.
- **AC12.** Local `git tag` shows `v0.1.0` (or current `manifest.json` version) on the yolo branch HEAD.
- **AC13.** No `git push` was executed during exec.

### Build/test gates

- **AC14.** `npm run build` exits clean.
- **AC15.** `npm run test:unit` exits clean — including all new tests.
- **AC16.** `npm run test:e2e` exits clean — including new hygiene e2e tests.
- **AC17.** `cargo build --release` exits clean (regression check on Phase 1's audit).

## User Testing

What Steve should try after Phase 3 GREEN, in order:

1. **Run `release.sh`.** Confirm it produces `anvil-obsidian-terminal-v0.1.0.zip` in the repo root (or wherever the script puts it), prints a SHA256, and creates a local `v0.1.0` tag. Confirm `git status` is clean and no `git push` ran.
2. **Inspect the zip.** `unzip -l anvil-obsidian-terminal-v0.1.0.zip` should show four entries: `manifest.json`, `main.js`, `styles.css`, `bin/pty-server`. The latter should have executable bit set.
3. **Cold install in a clean vault.** Pick a vault that doesn't currently have the plugin. Unzip into `<vault>/.obsidian/plugins/anvil-obsidian-terminal/`. Run `xattr -d com.apple.quarantine bin/pty-server` per the install docs. Open the vault in Obsidian, enable the plugin in Settings → Community plugins. Open a terminal — it should work.
4. **Test the missing-binary notice.** Delete `bin/pty-server` from the install. Reload the plugin. The notice should fire with a clear message, not a stack trace.
5. **Run hygiene scenarios.** Walk through the new "Phase 3 — process hygiene" section in `manual-test-checklist.md`. For force-quit: open terminals, run `pkill -9 Obsidian` from another terminal, restart, verify no orphan `pty-server` or shell PIDs. For OS-level binary kill: open a terminal, find the `pty-server` PID via `ps`, `kill -9` it, verify the plugin's terminal view surfaces the disconnect cleanly. Document outcomes in the checklist.
6. **Publish (when ready, manually).** Push the yolo branch to GitHub. Push the `v0.1.0` tag. Draft a release on GitHub against the tag. Upload the zip + SHA256. Click publish.

## Boundaries

- **Out:** Pushing anything to GitHub during exec. Tagging is local-only.
- **Out:** Codesigning / notarization — explicitly deferred (D1).
- **Out:** Cross-platform builds — macOS arm64 only (parent meta-plan constraint).
- **Out:** Auto-update or migration for users on a previous install. There is no previous install.
- **Out:** Fixing a hygiene leak that costs > 1 day to fix; record as FI per D3.
- **Out:** Any settings or theme changes (Phase 2 territory).
- **Out:** Major-version bump of any dep — Phase 1 territory; Phase 3 only ships current pins or absorbs an already-merged Dependabot PR.

## Sources

- `specs/anvil/future-ideas-backlog.md` — FI-017 + FI-018 bodies
- `specs/anvil/manual-test-checklist.md` — pattern + existing rows; new section appends here
- `specs/anvil/shippable-plugin/phase-1-grooming-completion.md` — Cargo Dependabot first-PR check note (R10/R14)
- `specs/anvil/shippable-plugin/phase-2-settings-and-theming-completion.md` — typings package bump may roll into release
- `manifest.json` — version + `minAppVersion`
- `esbuild.config.mjs` — current build orchestration; release.sh wraps it
- `src/main.ts` `onload` — where the missing-binary check goes
- `src/pty/` — `PtyBackend.dispose`, `BinaryClient.close` for AC4
- `tests/e2e/plugin.e2e.ts` — pattern for plugin-lifecycle e2e tests
- `pty-server/Cargo.toml` — Cargo dep state for R10
- `.github/dependabot.yml` — Phase 1's Cargo entry; Dependabot status check for R14
- `README.md` — install section update target (R9)
- Obsidian `Plugin` API docs for `Notice` (R7)
- `specs/anvil/testing-approach.md` — test strategy
- ADR-0001 / 0002 — macOS arm64 only, manual install only — confirms phase boundaries
