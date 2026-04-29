# Known Bugs

Open bugs tracked outside the future-ideas backlog. These are confirmed defects with concrete repros, not deferred features.

Entries follow the same conventions as `future-ideas-backlog.md`: stable ID, append-only, remove on fix. Use `BUG-###`.

---

## BUG-001: Workspace restore mounts terminal as a sibling tab instead of bottom-docked

**Symptom.** Close Obsidian with a bottom-docked terminal open. Re-launch Obsidian. The terminal restores as a top-level tab next to the note — same level as the file explorer / notes panes — instead of bottom-docked. Workspace is otherwise functional; the terminal still works, it's just in the wrong layout slot.

**Confirmed on:** macOS, Obsidian 1.12.7, plugin commit `cd8f178` (and the broader phase-1 glyph-rendering branch). Reproed in `Vaultnacious-v2` after a quit-with-terminal-open + relaunch on 2026-04-28.

**Workaround.** Close the terminal tab (`x` on the tab) before quitting Obsidian. The next launch comes up clean. If you forget and end up in the broken state: `Cmd-W` to close the misplaced terminal tab, then re-open via `Cmd-P → "Open terminal"` — wrap-and-dock fires correctly on user-initiated open.

**Root cause (suspected).** The plugin's wrap-and-dock logic (`src/dock/wrap-and-dock.ts`, called from `src/main.ts` `openDefaultTerminal`) only fires when the user invokes the "Open terminal" command. Obsidian persists the terminal leaf in `workspace.json` on quit. On relaunch, Obsidian recreates the leaf wherever workspace.json says it was — but the wrap-and-dock structure (rootSplit horizontal flip + wrapper) is either not faithfully restored or was never persisted in the first place. The leaf comes back, but the surrounding split structure doesn't.

`src/main.ts:419` `reconcileWrap` only handles the close path (unwrap when terminal closes). There is no restore-path equivalent that detects "terminal leaf exists at root but isn't bottom-docked, please redock."

**Why current tests don't catch it.** No test in the suite simulates a full Obsidian quit-and-relaunch cycle with persisted workspace state. The wdio harness creates a fresh ephemeral vault per spec.

- `tests/e2e/phase-3-hygiene.e2e.ts` AC1 disables and re-enables the plugin **within a single Obsidian session** — same Obsidian process, same workspace state in memory.
- `tests/e2e/fi-012-wrap-and-dock.e2e.ts` AC15 reverse closes the container and asserts rootSplit is restored — but that's the close path, which already works.
- `tests/e2e/container-view.e2e.ts:260` "restore" code is about the bottom-buffer height memory, not workspace-leaf-position restore.

The missing scenario: open terminal → save workspace.json → tear down Obsidian → start fresh Obsidian against the same vault → assert terminal is bottom-docked. That sequence isn't expressible in the current harness without significant work; wdio-obsidian-service launches a single Obsidian instance per spec and discards the vault between specs.

**Earlier related symptom (already fixed by accident, not by intent).** During the phase-1 dev session on 2026-04-28, an earlier form of the same restore path produced a "Loading workspace..." hang — Obsidian stalled completely on relaunch with a saved terminal leaf. We worked around it by wiping `workspace.json`. After the FontFace API rewrite of the bundled-font path, the hang stopped reproducing, but the leaf-in-wrong-place bug surfaced as a follow-on. Either the hang was sensitive to early-onload timing (the synchronous `fs.readFileSync` of the woff2 in `registerBundledFont` is the only meaningful ordering change on the onload path) or it was a transient state. **Treat the hang as latent, not fixed** — no test covers it.

**Suggested fix path.**

1. Add a `reconcileRestore` (or extend `reconcileWrap`) that runs on `layout-change` after Obsidian's layout-ready event. If a terminal leaf exists but its parent isn't rootSplit's horizontal-bottom slot, run wrap-and-dock to redock it.
2. Care: the redock must NOT fire mid-user-drag (would steal focus during a pane resize). Gate on `app.workspace.layoutReady` and only run once per layout-restore.
3. Test surface: extend the e2e harness with a "save workspace.json, tear down, relaunch, assert" pattern. May need a custom wdio service hook that sequences two Obsidian launches against the same persisted vault.

**Origin:** Phase 1 (glyph-rendering) dogfooding, 2026-04-28. Surfaced after the FontFace API fix unblocked workspace restore from its earlier "Loading workspace..." hang.
