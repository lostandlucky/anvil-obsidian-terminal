# Phase Spec: Phase 1 — Grooming

## Objective

Set a clean baseline before the larger work in P2 and P3 builds on top. The dependency audit (FI-020) runs first inside the phase so any binary upgrade or pin change lands before resize work tests against it; the resize double-fit (FI-019) is then identified and either removed (with regression test) or documented as load-bearing.

## Decisions for Review

These need a resolution before exec proceeds. Auto-resolved per the overnight orchestrator's policy: pick the architecturally-soundest option for this codebase, defaulting to "stay close to upstream, never silently leave the project on a stale pin."

### D1: `wdio-obsidian-service` pin

Currently pinned at `3.0.2` (npm). Upstream `3.0.2` is the latest as of audit time (verified `npm view wdio-obsidian-service version` → `3.0.2`).

**[RESOLVED]** — Hold at `3.0.2`. Already current upstream. Action: confirm Dependabot is wired so future bumps surface as PRs (config exists at `.github/dependabot.yml`; verify it's catching this package via the `wdio` group).

### D2: Obsidian test binary pin

Currently pinned at `1.12.3` in `package.json` `obsidian` field (used by `wdio-obsidian-service` for the test-environment Obsidian app).

**[RESOLVED]** — Read current Obsidian stable from `https://obsidian.md/changelog/` or the release feed. If we are within ~1 minor of stable, hold; otherwise bump to `current_stable - 0.0.1` and run the full e2e suite. If a bump is required and breaks any test, **revert the bump** and record the breakage as an FI in `future-ideas-backlog.md` rather than chasing it inside this phase. Phase 1 is grooming, not migration.

### D3: Cargo Dependabot

Currently no Cargo entry in `.github/dependabot.yml`. Phase 2a notes flagged this as overdue.

**[RESOLVED]** — Add a `cargo` entry to `.github/dependabot.yml` pointing at `pty-server/`, weekly cadence, same `dependencies` label. Group all updates so we review them as a set (mirrors the `wdio` grouping pattern already in the file).

### D4: Double-fit treatment

`src/terminal/xterm-host.ts` calls `fit.fit()` once during `mount()` and again from a `ResizeObserver` callback that fires on the same initial container observation. This is the suspected double-fit.

**[RESOLVED]** — **Remove the redundant call** by debouncing or skipping the first ResizeObserver fire when dimensions already match what `mount()` produced. Add a unit test that asserts `fit()` is called exactly once during a single-mount-then-stable-size lifecycle. If removal turns out to break anything observable (cursor positioning, initial scrollback), revert and document the call as load-bearing inline at the call site, with a one-line comment explaining the constraint.

## Requirements

- **R1.** `wdio-obsidian-service` pin posture is recorded explicitly: bumped, deferred, or held at current with a reason.
- **R2.** Obsidian test binary pin posture is recorded explicitly with the current Obsidian stable version named, the lag (in minors) named, and the decision (bump / hold) named.
- **R3.** `.github/dependabot.yml` has a Cargo entry that targets `pty-server/`. The entry uses the same conventions as the existing npm entry (label, group pattern).
- **R4.** Three undocumented Obsidian APIs are re-verified against the active pinned binary: `rootSplit.setDirection`, `workspace.createLeafInParent`, `SuggestModal.chooser.setSelectedItem`. Verification means: a smoke check confirming the API exists and behaves the way production code expects. Any drift is either fixed or recorded as a known-limitation FI.
- **R5.** A fourth undocumented API joined the production set during pane-chrome work: `workspace.createLeafBySplit` (used in `src/dock/wrap-and-dock.ts` per ADR-0007). Re-verify it under the same rubric as R4.
- **R6.** The resize double-fit is either removed (with a unit test pinning the new behavior) or documented inline at the call site as load-bearing.
- **R7.** All existing unit + e2e tests stay green after this phase's changes.
- **R8.** Test the dependency-audit findings *as data*, not as imperative-style assertions: the deliverable should include a written audit summary in the phase completion report, not just code changes.

## Acceptance Criteria

These are binary, outcome-based, verifiable.

- **AC1.** `package.json` either pins `wdio-obsidian-service` at the version recorded in D1's resolution, or has been deliberately updated to a newer version with the bump rationale in the completion report.
- **AC2.** `package.json` either pins `obsidian` at the version recorded in D2's resolution, or has been deliberately updated, with the lag-vs-stable explicitly captured in the completion report.
- **AC3.** `.github/dependabot.yml` parses successfully (verified via a Dependabot-config validator OR a YAML lint) and contains a `cargo` ecosystem entry pointing at `/pty-server`.
- **AC4.** A re-verification log entry exists for each of `rootSplit.setDirection`, `workspace.createLeafInParent`, `SuggestModal.chooser.setSelectedItem`, and `workspace.createLeafBySplit`, captured in the completion report. Each entry states: API present (yes/no), behavior matches production assumption (yes/no), action taken (none / fix / FI filed).
- **AC5.** Either: a unit test exists that fails on the pre-change xterm-host (double `fit.fit()` call during mount-then-stable) and passes after the change. OR: an inline comment exists at the redundant call site naming the load-bearing constraint, AND the completion report documents why removal was rejected.
- **AC6.** `npm run build` exits clean.
- **AC7.** `npm run test:unit` exits clean (all green).
- **AC8.** `npm run test:e2e` exits clean (all green).
- **AC9.** `cargo build --release` (in `pty-server/`) exits clean.

## User Testing

What Steve should try after Phase 1 GREEN:

1. **Open and resize a terminal pane.** Drag the splitter or the Obsidian window. Resize should reflow xterm cleanly with no visible flicker. (FI-019.)
2. **Reload the plugin from settings.** Open a terminal, disable + re-enable the plugin. New terminal opens cleanly; existing PTY processes go away cleanly. (Hygiene check, P3 will deepen this.)
3. **Open `.github/dependabot.yml`.** Confirm the Cargo entry is present and groups updates the way the npm entry does. (FI-020.)
4. **Spot-check a tmux attach if available.** Confirms `SuggestModal.chooser.setSelectedItem` still pre-selects the default shell. (R4 verification.)

## Boundaries

- **Out:** Any UI changes beyond what the resize fix mandates. Settings tab work is Phase 2.
- **Out:** Any new undocumented-API usage. Re-verify what's there; don't add new ones.
- **Out:** Any Cargo dep bump or `wdio-obsidian-service` major-version migration. The phase audits and records; bumps happen in their own future PRs.
- **Out:** Theme integration. Phase 2.
- **Out:** Manual-test-checklist updates beyond what the resize fix introduces.

## Sources

- `specs/anvil/future-ideas-backlog.md` — FI-019 + FI-020 bodies
- `specs/anvil/testing-approach.md` — read before adding any new test
- `src/terminal/xterm-host.ts` — the double-fit site
- `src/main.ts:214–280` — `createLeafInParent` + `setDirection` use sites
- `src/picker/profile-picker.ts:27, 72` — `setSelectedItem` use site
- `src/dock/wrap-and-dock.ts:20–128` — `createLeafBySplit` + `setDirection` use sites
- `.github/dependabot.yml` — the npm group pattern to mirror for cargo
- `pty-server/Cargo.toml` — the cargo project the new Dependabot entry points at
- `CLAUDE.md` § Dependency Maintenance — the cadence rule that gates this work
