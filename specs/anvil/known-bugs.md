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

---

## BUG-002: pty-server SIGTERM-vs-WS-flood race causes >1s kill latency

**Symptom.** When `pty-server` is streaming heavy WebSocket output (e.g. running `yes` after the renderer has disconnected), the binary occasionally takes longer than 1 second to exit after SIGTERM is sent. The kill *does* eventually propagate — pty-server exits cleanly within a few seconds, no permanent orphan — but the latency is non-deterministic and load-sensitive.

**Confirmed on:** macOS, Obsidian 1.12.7, plugin commit `d56334e` (yolo/phase-4-overnight-2026-04-27 branch). Reproduced 2026-04-29 during the v0.1.1 audit by running `tests/e2e/phase-3-hygiene.e2e.ts` AC3 ten times. Empirical pass rate at the original 1s budget: 4/5 with a clean process table, 2/5 with ~16 stale pty-servers polluting the box. Bumping the test's budget to 3s pushed pass rate to 5/5 in clean conditions; a follow-up 10x rerun is recorded in the audit log.

**User impact.** Negligible. Tab close still cleans up; latency goes from "imperceptible" to "1–3 seconds" under heavy-output conditions. Below user perception except in adversarial workloads.

**Root cause (suspected).** `pty-server`'s session loop (`pty-server/src/main.rs:233`) uses `tokio::select! { biased; _ = shutdown.wait() => break, ... }`, so SIGTERM should preempt promptly. But under heavy `yes` output, the loop spends most of its time inside `ws_sink.send(...).await` (line 251). After the JS-side `socket.close()`, sends to the dead peer eventually fail and break the loop — but the failure isn't instant; the underlying TCP layer drains queued bytes first. The signal-handler task DOES set `shutdown.trigger()` immediately when SIGTERM lands, but the session loop can't observe it until the in-flight `await` returns control to the executor.

**Why this isn't BUG-001 / the lifecycle leak.** BUG-001 is workspace-restore re-mounting a leaf wrong. The dogfooding-observed lifecycle leak (orphaned pty-servers from Obsidian force-quit, OS shutdown, or interrupted wdio runs) is a *parent-death* problem — the JS side never sends SIGTERM at all, so pty-server has nothing to react to. BUG-002 is the *post-SIGTERM latency* problem: the JS sends the signal, pty-server gets it, but takes >1s to act on it under WS-flood conditions. The 21 historical zombies cleaned up during the v0.1.1 audit were lifecycle-leak artifacts, not BUG-002 artifacts.

**Why current tests caught it.** AC3 in `phase-3-hygiene.e2e.ts` originally asserted kill within 1s. That assertion is what surfaced this — see the audit notes from 2026-04-29 (5 clean reruns: 4 pass / 1 fail; 5 reruns under zombie load: 2 pass / 3 fail). The budget was relaxed to 3s pending a structural fix.

**Suggested fix paths.**

1. **Surgical.** When `shutdown.trigger()` fires, also force-close the WebSocket sink from the signal handler so any in-flight `ws_sink.send().await` fails immediately rather than waiting for the underlying TCP timeout.
2. **Sturdier.** Move WS writes off the session loop into a dedicated writer task fed by a bounded channel. The session loop becomes pure shutdown/PTY coordination and can break out instantly.
3. **Cheap.** Add a coarser pre-check inside the send branch: `if shutdown.is_set() { break; }` immediately before each `ws_sink.send`. Doesn't help when blocked *inside* the await, but tightens the average case.

Estimated cost: small Rust phase, 1-2 days. Low structural risk because the kill mechanism already works end-to-end; this is a latency tightening, not a correctness fix.

**Origin:** v0.1.1 release audit, 2026-04-29.
