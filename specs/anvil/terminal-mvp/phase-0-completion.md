# Phase 0 Complete: Test Harness Spike + Dependency Audit

**Mode:** Qualitative (scaffold + checklist verification)
**Cycles:** 1 (clean pass)
**Status:** GREEN — all 10 acceptance checks pass on the first run

## Deliverables

- `phase-0-audit.md` — security audit of `wdio-obsidian-service@3.0.2` against repo commit `555750b`, approved verdict **CONDITIONAL SAFE** with four conditions applied
- `package.json` — exact version pins, no `^`/`~`:
  - `wdio-obsidian-service@3.0.2`, `wdio-obsidian-reporter@3.0.2`
  - `webdriverio@9.27.0`, `@wdio/cli@9.27.0`, `@wdio/local-runner@9.27.0`, `@wdio/mocha-framework@9.27.0`, `@wdio/globals@9.27.0`
  - `vitest@4.1.4`, `mocha@10.8.2`, `tsx@4.21.0`, `typescript@5.9.3`
- `package-lock.json` committed
- `wdio.conf.mts` — Obsidian binary pinned to `1.12.7` (app + installer), cache dir set to project-local `./.obsidian-cache`
- `vitest.config.ts` — picks up `tests/unit/**/*.test.ts`
- `tsconfig.json` — strict, ESM, types for wdio-obsidian-service
- `tests/unit/smoke.test.ts` — trivial passing unit test
- `tests/e2e/smoke.e2e.ts` — launches Obsidian, asserts workspace loaded, quits cleanly
- `tests/e2e/fixtures/vault/` — minimal empty vault used by the smoke test
- `.github/dependabot.yml` — weekly npm updates, wdio packages grouped so they review as a set
- `.gitignore` — `node_modules/`, `.obsidian-cache/`, logs, build output

## Test run

```
npm test
├─ vitest run          ✓ 1 passed
└─ wdio run            ✓ 1 passed — Obsidian 1.12.7 launched, workspace loaded, clean teardown
```

First run downloaded the Obsidian DMG (~520 MB) to `./.obsidian-cache/`. Second run used the cache and completed in ~1 second. Typecheck (`tsc --noEmit`) is clean. No orphaned test-spawned Obsidian processes after runs.

## User testing

1. **Fresh install** — `git clone`, `npm install`, `npm test` should go green end-to-end. The first e2e run will take a few minutes while it downloads Obsidian 1.12.7; subsequent runs are near-instant.
2. **Cache location** — confirm `./.obsidian-cache/` exists in the project dir after a run, and that `~/.obsidian-cache` does NOT exist. Audit condition 3 in action.
3. **Run the e2e twice in a row** — `npm run test:e2e && npm run test:e2e`. Second run should be as green as the first with no stale-state issues.
4. **Check dependabot** — once this commit is pushed, GitHub → Insights → Dependency graph → Dependabot should show the config is picked up.
5. **Read the audit** — `phase-0-audit.md`. The four conditions there are load-bearing; they are not revisited automatically and it's worth knowing them.

## Notes for downstream phases

- **Phase 1 inherits a working harness.** The fallback (Vitest + manual checklist) was NOT invoked — Phase 1 can write real e2e tests against real Obsidian from day one.
- **Obsidian pin is `1.12.7` exact.** Current stable at audit time. Re-evaluate in Phase 1 kickoff per the monthly cadence in `CLAUDE.md` → Dependency Maintenance.
- **Four audit conditions stand** and should be preserved by Phase 1:
  1. Exact version pins for all harness packages.
  2. No Obsidian Insider / no interactive credential mode.
  3. `cacheDir` stays project-local (`./.obsidian-cache`, git-ignored).
  4. Re-audit on every Dependabot version bump (review the metadata/digest diffs, not just the version number).
- **Known-accepted `npm audit` findings.** Six high-severity transitive vulns (lodash via `obsidian-launcher`, serialize-javascript via `mocha`) are documented in `phase-0-audit.md` as non-reachable in our threat model. Do not "fix" them by switching tooling — they're real CVEs but unreachable in a local dev test harness. Revisit if Dependabot offers upstream fixes.
- **Node version note.** Dev machine is on Node 23.9 (non-LTS). `npm install` emits `EBADENGINE` warnings from a few `@jest/*` transitive deps that want 18/20/22/24+. Harmless right now. Worth revisiting when we consider Node 22 LTS or 24 LTS for the project baseline.
- **Phase 1 spec already exists** (`phase-1-scaffold-spec.md`) — untracked in git at this session's start, authored before Phase 0. Steve should commit it whenever convenient; Phase 0 did not touch it.
- **`plugins` option in `wdio:obsidianOptions` is NOT set** in the current `wdio.conf.mts`. Phase 1 will add `plugins: ["."]` once a real `manifest.json` and build output exist.
