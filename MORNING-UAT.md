# Morning Queue — bug-sweep — 2026-07-14

## Needs your decision (parked forks)

- Pre-batch — Dependency sweep (deliberately out of the overnight run; dependencies are park-bar): 9 open Dependabot PRs, including the wdio e2e-harness group (#12, open since May 18 — past the ~6-week staleness threshold in CLAUDE.md), `obsidian` API types 1.12.3→1.13.1 (#21), and a TypeScript 6→7 major (#33). Review changelogs and merge/defer deliberately.

## Manual verification (unautomatable acceptance criteria)

- Phase 1 — True quit-relaunch redock (MT-016): in a real vault, open a terminal (bottom-docked), quit Obsidian normally AND via `pkill -9 Obsidian`, relaunch each time. Expect: terminal comes back **bottom-docked** (never as a sibling tab next to a note), tab strip intact, fresh shell, no console errors. Why manual: the wdio harness cannot relaunch the host app — the automated coverage simulates serialize→restore in-process (`tests/e2e/bug-001-restore-redock.e2e.ts`).
- Phase 1 — Latent "Loading workspace…" hang watch (MT-016 watch item): during the relaunches above, if Obsidian stalls at "Loading workspace…", capture the console and file it as a new bug — that's the latent pre-fix hang from BUG-001's history, still uncovered by tests. Not expected, but this is the first change to touch that path since it was recorded.
- Phase 1 — No fighting deliberate moves / drags (MT-017): drag the docked terminal tab next to a note and confirm it stays there for the session (no snap-back); wiggle a pane-resize divider right after relaunch and confirm the redock never interrupts or steals focus mid-drag; a terminal parked in a popout window should be left untouched after relaunch. Why manual: real pointer drags aren't honestly drivable in the Electron harness; "focus lands somewhere sane" is a judgment call.
