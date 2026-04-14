# 0002. Manual install only, no community plugin store

- **Status:** Accepted (retrospective)
- **Date:** 2026-04-13

## Context

Obsidian has a community plugin store. Submitting to it means a review process, a maintenance commitment to a public user base, security expectations, support load, and an implicit promise of cross-platform support (or a clear desktop-only/platform-specific justification).

This plugin is currently a Phase 1 scaffold for a solo developer. There is no settings UI, no real shell yet, no multi-instance hardening, and the validation envelope is one platform (see [ADR 0001](0001-macos-arm64-only.md)). Submitting to the store now would create a contract the project can't honor.

## Decision

The plugin is **install-by-hand only**. Distribution is: clone the repo, build, copy `main.js` / `manifest.json` / `styles.css` into a vault's plugin folder. No store submission, no GitHub Releases artifacts, no auto-updater, no BRAT entry. The README and how-to docs document the manual flow as the only flow.

## Consequences

**Easier:**

- No review process, no rejection cycles, no public bug tracker pressure.
- Breaking changes between phases are free — no users to migrate, no compat shim debt.
- Security model is simpler: the only people running this are people who built it themselves and read what they were installing.
- Phase pacing is set by the project, not by store reviewer cadence or a public release schedule.

**Harder:**

- Discoverability is zero. Anyone who isn't reading this repo doesn't know it exists.
- Updates require the user to re-run the build-and-copy steps by hand. There is no notification when a new version lands.
- Onboarding friction is high enough that "early external installer" really means "someone who already builds Obsidian plugins."

**Reversible?** Yes, cheaply. Submitting to the store later is mostly paperwork plus meeting whatever cross-platform and quality bar the reviewer sets at that time. The current decision doesn't foreclose anything — it just defers the cost until the plugin actually warrants it. Practical preconditions for revisiting: Phase 2 PTY backend locked, settings UI exists, multi-instance behavior is tested, at least one platform other than mac-arm64 has been validated.
