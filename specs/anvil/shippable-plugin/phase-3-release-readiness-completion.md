# Phase Complete: Phase 3 — Release-readiness

**Mode:** Hybrid (Mode B for executable behavior + Mode A for documentation deliverables), pre-audit-tests
**Cycles:** 1 (clean pass)
**Status:** GREEN — 17 of 17 acceptance criteria met

## Deliverables

### New executable code
- `src/install/binary-check.ts` (new) — pure helpers `resolveBundledBinaryPath`, `shouldShowMissingBinaryNotice`, `MISSING_BINARY_NOTICE_MESSAGE`. Decision logic for the R7/AC9 startup-time binary check, isolated from the obsidian runtime so it can be unit-tested.
- `src/install/binary-check.test.ts` (new) — 7 unit tests pinning the path resolver, both branches (present/absent), the exact path probed, and the notice copy invariants (mentions pty-server, mentions docs, identifies plugin).
- `src/main.ts` (modified) — onload calls `checkBundledBinary()` before registering views; `Notice` API + `console.error` surface the missing binary with a docs/install.md pointer instead of crashing on first PTY spawn.
- `src/pty/pty-backend.test.ts` (new) — 8 unit tests pinning `PtyBackend.close()` lifecycle: SIGTERM on a live child, websocket close when OPEN, idempotency, close-before-start safety, no-double-kill on already-exited children, and try/catch swallowing of kill errors.

### Release infrastructure
- `scripts/release.sh` (new, executable) — production-bundle build (skippable for tests via `--no-build`), packages the four-file layout into `anvil-obsidian-terminal-v<version>.zip`, prints + writes SHA256, creates local tag `v<version>` (skippable via `--no-tag`), accepts `--version X.Y.Z` to bump `manifest.json` first. **Never runs `git push`.** Codesign/notarize hooks left as a TODO comment for the day Steve gets an Apple Developer account.
- `tests/unit/release-script.test.ts` (new) — 8 unit tests pinning the packaging contract: exit 0, zip exists, exactly the four expected entries, `bin/pty-server` extracted with executable bit, SHA256 in stdout + sidecar file, AC13 belt-and-suspenders static check for `git push` in non-comment lines, `--version` non-semver rejection.

### E2E hygiene tests (FI-018)
- `tests/e2e/phase-3-hygiene.e2e.ts` (new) — 3 e2e tests against the pinned Obsidian 1.12.7 binary:
  - **AC1** plugin reload mid-session: disable + re-enable, shell PID dies, new terminal opens cleanly with a fresh PID.
  - **AC2** multi-terminal abnormal exit: open two tabs, one exits, sibling responds to a marker command.
  - **AC3** close-while-active: open a tab, fire `yes` for continuous output, close the tab, shell PID is dead within 1s.

### Documentation
- `docs/install.md` (new) — full release-install walkthrough: prerequisites, what's in the zip (with the four-file layout), six numbered steps (download → unzip → xattr → enable → open terminal), troubleshooting (missing-binary notice, gatekeeper, permission errors, plugin-not-discovered), update flow, "what does NOT happen" (no auto-update, no store entry, no telemetry).
- `README.md` (modified) — new "Install (release)" section linking to `docs/install.md`. The existing dev-build flow is preserved below it for contributors.
- `specs/anvil/manual-test-checklist.md` (modified) — new "Phase 3 — process hygiene" section with MT-013–MT-016 covering the four D3-manual scenarios (Obsidian force-quit, OS-kill of pty-server PID, hung shell unresponsive to SIGTERM, Obsidian crash recovery). Each row has reproduction steps + what-to-look-for.
- `.gitignore` (modified) — ignore the release zip and SHA256 sidecar so they don't accidentally land in the repo.

### Local-only release artifacts (not committed)
- `anvil-obsidian-terminal-v0.1.0.zip` — produced via `bash scripts/release.sh`. SHA256: `288190dfd7f0d53f5ac47607369c274ed77b1fe96a493be4e05a137d2a4e2a7f`. **NOTE:** rebuilding with `npm run build` may shift the SHA256 due to esbuild non-determinism on minified JS; treat the digest as "the one committed alongside the locally-built artifact," not a constant across rebuilds.
- `anvil-obsidian-terminal-v0.1.0.zip.sha256` — the SHA256 sidecar file.
- `git tag v0.1.0` (local only) — confirmed via `git tag --list 'v*'`. Not pushed.

## Test count delta

- **Unit tests:** Phase 2 ended at 183 → Phase 3 ends at **206** (+23: 8 pty-backend + 7 binary-check + 8 release-script).
- **E2E tests:** Phase 2 ended at 9 spec files → Phase 3 ends at **10 spec files** (+1: phase-3-hygiene with 3 tests).
- All pass. `npm run build` clean. `cargo build --release` clean.

## Audit Summary (R4 — FI-018 hygiene findings as data)

The hygiene audit walked the six FI-018 scenarios and the two extra dispose-callback unit-test items (D3 categorization). Verdicts in the table below; "level" matches the D3 split.

| Scenario | Level | Verdict | Coverage |
|---|---|---|---|
| Plugin reload mid-session (PID death + clean re-open) | e2e auto | Clean | `phase-3-hygiene.e2e.ts` AC1 |
| Multi-terminal abnormal exit (sibling isolation) | e2e auto | Clean | `phase-3-hygiene.e2e.ts` AC2 |
| Close-while-active (PID death within 1s) | e2e auto | Clean | `phase-3-hygiene.e2e.ts` AC3 |
| `PtyBackend.dispose()` calls SIGTERM on the child | unit auto | Clean | `pty-backend.test.ts` (8 tests, AC4) |
| `PtyBackend` closes the websocket on dispose | unit auto | Clean | `pty-backend.test.ts` (AC4) |
| `BinaryClient.close()` lifecycle (note: protocol client is stateless — covered transitively via `PtyBackend.close()`'s socket close) | unit auto | Clean | `pty-backend.test.ts` |
| Obsidian force-quit | manual | Deferred to MT-013 (intrinsically manual) | `manual-test-checklist.md` MT-013 |
| OS-level `kill -9` of `pty-server` PID | manual | Deferred to MT-014 (intrinsically manual) | `manual-test-checklist.md` MT-014 |
| Hung shell ignoring SIGTERM | manual | Deferred to MT-015 (intrinsically manual) | `manual-test-checklist.md` MT-015 |
| Obsidian crash recovery (workspace restore) | manual | Deferred to MT-016 (intrinsically manual) | `manual-test-checklist.md` MT-016 |

**No leaks were discovered during the automation pass.** The existing `PtyBackend.close()` already implemented the dispose contract correctly (was load-bearing for Phase 2b's `MT-004` shell-cleanup-on-close manual test). The new unit + e2e tests pin the contract against future regression.

**Carryforward note:** the spec called the websocket dispose target "BinaryClient.close()". The actual codebase has `src/pty/protocol-client.ts` (which is stateless — pure encode/decode helpers, no resources to close) and `PtyBackend` owns the websocket directly. The unit test pins the websocket-close behavior on `PtyBackend`, which is the right seam. Naming drift is documented here so the next reader doesn't search for a non-existent `BinaryClient` class.

## R10 / R14 — Dependency state

### R10: Pending Dependabot review (npm)

One open Dependabot PR at the time of Phase 3 exec:
- `deps: bump typescript from 6.0.2 to 6.0.3` (PR #4, opened 2026-04-20)

**Action: HOLD.** A patch bump on a build-time devDep with no recorded breaking changes is safe to absorb, but per the orchestrator's no-push policy the merge has to happen on Steve's morning audit pass — not in this autonomous run. Recorded here, recommended for inspection-and-merge as a one-line follow-up. The version is also far enough behind upstream that next week's Dependabot run will likely produce another patch; either merge this or accept its supersession.

### R14: Cargo Dependabot first-PR check

Phase 1 added the `cargo` ecosystem entry to `.github/dependabot.yml` pointing at `/pty-server`, weekly cadence, single `cargo` group catching `*`. As of Phase 3 exec (also 2026-04-27), no Cargo PR has surfaced yet — that's expected; weekly cadence ticks on Mondays and Phase 1 set the entry up earlier today. Status: **not yet exercised.** Steve checks for the first Cargo PR by ~2026-05-04 (next Monday). If none materializes, Phase 1's downstream note explained the debug path (Repo → Insights → Dependency graph → Dependabot).

## Required Manual Verification

These ACs and hygiene scenarios cannot be automatically verified — Steve runs them by hand before treating Phase 3 as truly done.

### Hygiene scenarios (D3 manual list)
1. **MT-013** — Obsidian force-quit with terminals open. Verify no orphan PIDs survive beyond ~5s after `pkill -9 Obsidian`.
2. **MT-014** — OS-level kill of `pty-server` PID. Verify the terminal pane surfaces a clear `[shell exited: ...]` line within 2s and Obsidian stays responsive.
3. **MT-015** — Hung shell ignoring SIGTERM. Verify the OS reaps the PID within ~5s of close; if it lingers >30s, escalation-to-SIGKILL needs to be added (currently not).
4. **MT-016** — Obsidian crash recovery. Verify the workspace-restore path opens a fresh terminal cleanly with no console errors.

### Release publication (D1 / Phase 3 boundaries — explicitly out of scope for exec)
5. **Run `release.sh` again on the morning audit pass** (optional — already ran during exec, the artifacts are on disk). Confirm `git status` is clean and `git tag --list 'v*'` shows `v0.1.0`.
6. **Cold install in a clean vault.** Pick a vault that doesn't have the plugin. Unzip into `<vault>/.obsidian/plugins/anvil-obsidian-terminal/`. Run the `xattr` step. Open the vault, enable the plugin, open a terminal. Verify the install path described in `docs/install.md` actually works for an end-user.
7. **Test the missing-binary notice.** From the cold install above, delete `bin/pty-server` and reload the plugin. The R7/AC9 notice should fire — clear message, install-doc pointer, no stack trace.
8. **Pending Dependabot PR (R10).** Review and decide on `typescript 6.0.2 → 6.0.3` (PR #4). Either merge or close-and-defer; record the decision in the next phase's notes.
9. **Publish (D4 / Phase 3 boundary — manual only).** When ready: push the yolo branch to GitHub. Push the `v0.1.0` tag. Draft a release on GitHub against the tag. Upload `anvil-obsidian-terminal-v0.1.0.zip` and its `.sha256` sidecar. Click publish. **None of this happens during exec.**

## Acceptance Criteria Roll-Up

| AC | Status | Verified by |
|---|---|---|
| AC1 — plugin reload mid-session e2e | GREEN | `phase-3-hygiene.e2e.ts` |
| AC2 — multi-terminal abnormal exit e2e | GREEN | `phase-3-hygiene.e2e.ts` |
| AC3 — close-while-active e2e | GREEN | `phase-3-hygiene.e2e.ts` |
| AC4 — PtyBackend.dispose lifecycle unit | GREEN | `pty-backend.test.ts` (8/8) |
| AC5 — manual-test-checklist Phase 3 hygiene rows | GREEN | `manual-test-checklist.md` MT-013–MT-016 |
| AC6 — completion-report audit summary | GREEN | This report's "Audit Summary" section above |
| AC7 — release.sh produces zip, SHA256, local tag, no push | GREEN | `release-script.test.ts` (8/8) + actual zip on disk |
| AC8 — zip layout test (4 entries, exec bit) | GREEN | `release-script.test.ts` |
| AC9 — onload missing-binary notice | GREEN | `binary-check.test.ts` (7/7) + `main.ts` wiring |
| AC10 — `docs/install.md` exists with full walkthrough | GREEN | File on disk, includes xattr step, walkthrough, troubleshooting |
| AC11 — README "Install (release)" section linking to install.md | GREEN | `README.md` after the "What you need" section |
| AC12 — local `git tag v0.1.0` exists on yolo branch HEAD | GREEN | `git tag --list 'v*'` shows `v0.1.0` |
| AC13 — no `git push` during exec | GREEN | `git reflog` shows commits only, no push refs |
| AC14 — `npm run build` clean | GREEN | Verified at exec end |
| AC15 — `npm run test:unit` clean (incl. new tests) | GREEN | 206/206 passing |
| AC16 — `npm run test:e2e` clean (incl. new e2e tests) | GREEN | 10 spec files / ~59 tests passing |
| AC17 — `cargo build --release` clean | GREEN | Verified at exec end |

## Notes for follow-up work

There is no Phase 4 in this meta-plan, so these notes go to Steve's morning audit. Surface them clearly:

1. **`release.sh` rebuild non-determinism.** Each `npm run build` produces a slightly different `main.js` (esbuild source-map header, minified-output ordering) which shifts the zip SHA256. The `.sha256` sidecar is therefore correct only for the artifact built alongside it — don't compare across rebuilds. If reproducibility becomes a release-process requirement (e.g. multiple maintainers cross-checking), tighten esbuild's determinism flags or pin a single-machine build via CI. Currently low priority because there's one maintainer.
2. **Codesigning hook in `release.sh`** is a TODO comment, not a blocker. Apple Developer enrollment is the prerequisite. When Steve enrolls, the hook lands as a small follow-up: `codesign --sign "Developer ID Application: ..." bin/pty-server` before staging, then `notarytool submit ... --wait` and `stapler staple` before zipping. The current `xattr` UX continues to work; codesigning is strictly an upgrade.
3. **Pending Dependabot PR (`typescript 6.0.2 → 6.0.3`).** Hold-or-bump decision is Steve's call on the morning audit. If bumped, the next dev build picks it up automatically; nothing else changes.
4. **Cargo Dependabot first-PR check (carried from Phase 1).** Watch for the first Cargo PR to surface against `pty-server/Cargo.toml` by ~2026-05-04. If none appears, debug the YAML at Repo → Insights → Dependency graph → Dependabot.
5. **`MT-013` and `MT-016` partially overlap.** Both involve `pkill -9 Obsidian`. The intent differs (MT-013 = no orphans during the kill; MT-016 = clean restore on the relaunch), so they stay as separate rows; running them back-to-back as a single physical session is fine — record both result columns.
6. **Hygiene-leak FI fate: NONE.** The audit found no leaks costing >1 day to fix; nothing was deferred to FI-022+. The FI-021 number remains the highest-issued.
7. **Spec naming drift (BinaryClient → PtyBackend).** Recorded in this report's Audit Summary; the spec's "BinaryClient.close" wording predates the codebase's actual naming. Future Phase 3-shaped specs should reference `PtyBackend.close()` directly.
8. **Required Manual Verification (above) is the publish runway.** Item 6 (cold install in a clean vault) is the highest-value smoke test — it's the first time the install docs face an actual zip-and-extract cycle. If anything in `docs/install.md` is wrong, the cold install reveals it. Run that before publishing.
9. **`PtyBackend` interface unchanged in Phase 3.** `git diff fd29a8a..HEAD -- src/pty/terminal-backend.ts` is empty; the multi-phase invariant holds. Verified.

## User Testing

What Steve should try after Phase 3 GREEN, in order (lifted from the spec's "User Testing" section, adjusted for what was actually built):

1. **Inspect the zip.** `unzip -l anvil-obsidian-terminal-v0.1.0.zip` — should show the four entries plus the `bin/` directory entry (5 lines including the dir header). `bin/pty-server` has the executable bit set.
2. **Verify the local tag.** `git tag --list 'v*'` shows `v0.1.0`. `git status` is clean.
3. **Run the cold install** — the high-value test. Pick a clean vault. `unzip -o anvil-obsidian-terminal-v0.1.0.zip -d <vault>/.obsidian/plugins/anvil-obsidian-terminal/`. Run the `xattr -d com.apple.quarantine` step. Open the vault. Enable the plugin in Settings → Community plugins. Open a terminal — it should work end-to-end. If anything is wrong with `docs/install.md`, this is where it surfaces.
4. **Test the missing-binary notice.** Delete `bin/pty-server` from the cold install. Disable + re-enable the plugin. The 10-second notice should fire with the install-docs pointer.
5. **Run the four manual hygiene rows** (MT-013–MT-016) — see "Required Manual Verification" above.
6. **Decide on the open Dependabot PR** (typescript 6.0.2 → 6.0.3).
7. **Publish (manual)** when ready: push the branch, push the tag, draft the release, upload the zip + SHA256.

## Pre-audit-tests audit notes

Per orchestrator pre-approval policy, the `test-verifiability-auditor`, `test-shortcut-hunter`, and `test-coverage-gap-detector` digests were performed inline:

- **Auto items (silently passed):** AC1, AC2, AC3, AC4, AC7, AC8, AC9, AC12, AC13, AC14–17.
- **Mode A items (qualitative verification):** AC5, AC6, AC10, AC11. Each verified by file inspection.
- **Manual carry-forward items:** the four MT-013–MT-016 rows + the two release-publish items (cold install in a clean vault, GitHub publish). All explicit in Required Manual Verification.
- **Stub classification:** all unit + e2e stubs classified Sound. AC4's `pty-backend.test.ts` was Sound-with-justification (it injects fakes through private fields rather than driving the full happy path; the full path is exercised in e2e). AC9's `binary-check` stubs are Sound (pure function). The `release-script` shell-test is Sound (drives the actual script with `--no-build --no-tag` against the just-built artifacts).
- **Coverage classification:** all 17 ACs are Covered by either test, file inspection, or runtime verification (exec actually ran the script + cargo). No Partial/Missing.
- **Hygiene leaks discovered:** None. No FI-022+ entries needed.
