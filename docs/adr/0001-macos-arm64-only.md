# 0001. Validate on macOS arm64 only

- **Status:** Accepted (retrospective)
- **Date:** 2026-04-13

## Context

This is a solo project with one developer on Apple silicon and no external users yet. The plugin will eventually need a PTY backend (Phase 2), and the candidate backends — Python `pty`, a Rust binary over WebSocket, `node-pty` with prebuilt binaries — have meaningfully different cross-platform stories. Spending Phase 1 effort on Linux and Windows compatibility before the backend is even chosen would be optimizing for users that don't exist against a design that isn't locked.

The Phase 1 code itself happens to be platform-agnostic (xterm.js + an in-process mock REPL, no native code, no shell spawning, no `process.platform` checks). What's mac-arm64-only is the *validation envelope*: the dev-launch script, the e2e harness, and all manual testing assume a mac. `manifest.json` only sets `isDesktopOnly: true`, which excludes mobile but not other desktops.

## Decision

The supported platform for this plugin is **macOS on Apple silicon**, and only that, until further notice. We will not test on Linux, Windows, or Intel macs. Documentation, install instructions, and dev tooling assume mac-arm64. We will not accept platform-portability changes that complicate the code without a real user motivating them.

## Consequences

**Easier:**

- Phase 2's PTY backend choice can ignore Windows (`ConPTY`, `node-pty` Windows builds) and any cross-distro Linux quirks. The decision space shrinks from "works everywhere" to "works on one well-known target."
- The dev-launch script and e2e harness can hard-code mac paths and a single Obsidian binary architecture.
- Documentation can be specific instead of hedged. README install steps say `cp` and mean it.

**Harder:**

- Adding a second platform later means a real audit pass: every shell command in docs, every path assumption in scripts, every native dependency in the eventual PTY backend. This is real work, not a flag flip.
- Anyone who tries to use the plugin on Linux or Windows is in unsupported territory. The code might run; the experience won't have been validated.
- If we ever submit to the Obsidian community plugin store, the reviewer will expect cross-platform support or a clear desktop-only justification. Both ADR 0001 and [ADR 0002](0002-manual-install-only.md) intersect here.

**Reversible?** Partially. The code is platform-agnostic today, so reversing means *adding* validation, not undoing past commits. But the longer we go without testing on other platforms, the more silent assumptions accumulate, and the more expensive the audit becomes.
