# Phase 0 Spec: Test Harness Spike + Dependency Audit

## Objective

De-risk the testing strategy before any feature code is written. Prove `wdio-obsidian-service` stands up on macOS arm64 against a pinned Obsidian version, and audit the package since it runs in the test env with filesystem/network access. Time-boxed to one working day.

## Decisions for Review

1. **Version pins.** Latest stable for both `wdio-obsidian-service` and the Obsidian test binary. **[RESOLVED: latest stable for both]**
2. **Dependabot vs Renovate.** **[RESOLVED: Dependabot]** — native to GitHub, zero setup.
3. **Audit verdict is Steve's call.** The agent writes up findings and drafts a recommended verdict with reasoning, then **pauses** for Steve to review before the verdict line is finalized. Do not self-approve. **[RESOLVED: agent drafts, Steve approves]**

## Requirements

- `package.json` with exact pins (no `^` / `~`) for `wdio-obsidian-service` and any related wdio packages it requires
- Obsidian test binary version pinned in the wdio config
- `package-lock.json` committed
- Dependabot (or chosen alternative) config watching the pinned packages
- `npm test`, `npm run test:unit`, `npm run test:e2e` scripts exist and route correctly
- One trivial Vitest unit test that passes
- One trivial e2e spec that launches Obsidian via the service, asserts the workspace loaded, and quits cleanly — no plugin code involved
- Audit notes committed as `phase-0-audit.md` covering: what the package downloads and from where, how it verifies the Obsidian binary, what it writes outside the project dir, what lifecycle hooks it runs. Must end with an explicit "safe to adopt / not safe / conditional" conclusion.
- Brief local-run instructions (how to run each test level, what the pinned versions are) — can live at the top of the audit doc or in a short README section

## Acceptance Criteria

1. `npm run test:unit` runs green
2. `npm run test:e2e` runs green against a real launched Obsidian instance
3. `npm test` runs both in sequence and exits green
4. `package.json` shows exact version pins for all harness-related packages
5. Obsidian test binary version is pinned (not floating) in the wdio config
6. Dependabot (or equivalent) config file present and targeting the pinned packages
7. `phase-0-audit.md` exists, covers the four audit questions, and ends with an explicit verdict
8. No orphaned Obsidian processes after the e2e run

## User Testing

1. Fresh clone → `npm install` → `npm test` should go green end-to-end.
2. Read `phase-0-audit.md` and sanity-check the verdict.
3. Confirm the Dependabot config shows up in the GitHub UI under Insights → Dependency graph once pushed.
4. Run `npm run test:e2e` twice in a row — second run should be as clean as the first (no cached state breaking things).

## Exit Condition if Time-Boxed Out

If the e2e smoke test is not green by end of day, stop. Document what was tried, what broke, and invoke the fallback from `../testing-approach.md` (Vitest units + manual checklist, revisit e2e in Phase 2). The audit and Vitest skeleton still ship regardless.

## Boundaries

- **No plugin code.** The smoke e2e test launches vanilla Obsidian, nothing more.
- **No Phase 1 scaffolding.** `manifest.json`, `main.ts`, esbuild config — all Phase 1.
- **No CI.** Local green is the bar for Phase 0. GitHub Actions can come later.
- **macOS arm64 only.**

## Sources

- **Meta-plan:** `meta-plan.md` (Phase 0 section)
- **Testing approach:** `../testing-approach.md`
- **wdio-obsidian-service:** https://github.com/jesse-r-s-hines/wdio-obsidian-service
- **Dependabot config reference:** https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file
