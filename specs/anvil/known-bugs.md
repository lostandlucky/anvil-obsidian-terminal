# Known Bugs

Open bugs tracked outside the future-ideas backlog. These are confirmed defects with concrete repros, not deferred features.

Entries follow the same conventions as `future-ideas-backlog.md`: stable ID, append-only, remove on fix. Use `BUG-###`.

---

## BUG-002: pty-server SIGTERM-vs-WS-flood race causes >1s kill latency

**Symptom.** When `pty-server` is streaming heavy WebSocket output (e.g. running `yes` after the renderer has disconnected), the binary occasionally takes longer than 1 second to exit after SIGTERM is sent. The kill *does* eventually propagate — pty-server exits cleanly within a few seconds, no permanent orphan — but the latency is non-deterministic and load-sensitive.

**Confirmed on:** macOS, Obsidian 1.12.7, plugin commit `d56334e` (yolo/phase-4-overnight-2026-04-27 branch). Reproduced 2026-04-29 during the v0.1.1 audit by running `tests/e2e/phase-3-hygiene.e2e.ts` AC3 ten times. Empirical pass rate at the original 1s budget: 4/5 with a clean process table, 2/5 with ~16 stale pty-servers polluting the box. Bumping the test's budget to 3s pushed pass rate to 5/5 in clean conditions; a follow-up 10x rerun is recorded in the audit log.

**User impact.** Negligible. Tab close still cleans up; latency goes from "imperceptible" to "1–3 seconds" under heavy-output conditions. Below user perception except in adversarial workloads.

**Root cause (suspected).** `pty-server`'s session loop (`pty-server/src/main.rs:233`) uses `tokio::select! { biased; _ = shutdown.wait() => break, ... }`, so SIGTERM should preempt promptly. But under heavy `yes` output, the loop spends most of its time inside `ws_sink.send(...).await` (line 251). After the JS-side `socket.close()`, sends to the dead peer eventually fail and break the loop — but the failure isn't instant; the underlying TCP layer drains queued bytes first. The signal-handler task DOES set `shutdown.trigger()` immediately when SIGTERM lands, but the session loop can't observe it until the in-flight `await` returns control to the executor.

**Why this isn't BUG-001 / the lifecycle leak.** BUG-001 (workspace-restore re-mounting a leaf wrong) was fixed 2026-07-14 by the restore-path redock (`src/main.ts` `reconcileRestore`, covered by `tests/e2e/bug-001-restore-redock.e2e.ts`). The dogfooding-observed lifecycle leak (orphaned pty-servers from Obsidian force-quit, OS shutdown, or interrupted wdio runs) is a *parent-death* problem — the JS side never sends SIGTERM at all, so pty-server has nothing to react to. BUG-002 is the *post-SIGTERM latency* problem: the JS sends the signal, pty-server gets it, but takes >1s to act on it under WS-flood conditions. The 21 historical zombies cleaned up during the v0.1.1 audit were lifecycle-leak artifacts, not BUG-002 artifacts.

**Why current tests caught it.** AC3 in `phase-3-hygiene.e2e.ts` originally asserted kill within 1s. That assertion is what surfaced this — see the audit notes from 2026-04-29 (5 clean reruns: 4 pass / 1 fail; 5 reruns under zombie load: 2 pass / 3 fail). The budget was relaxed to 3s pending a structural fix.

**Suggested fix paths.**

1. **Surgical.** When `shutdown.trigger()` fires, also force-close the WebSocket sink from the signal handler so any in-flight `ws_sink.send().await` fails immediately rather than waiting for the underlying TCP timeout.
2. **Sturdier.** Move WS writes off the session loop into a dedicated writer task fed by a bounded channel. The session loop becomes pure shutdown/PTY coordination and can break out instantly.
3. **Cheap.** Add a coarser pre-check inside the send branch: `if shutdown.is_set() { break; }` immediately before each `ws_sink.send`. Doesn't help when blocked *inside* the await, but tightens the average case.

Estimated cost: small Rust phase, 1-2 days. Low structural risk because the kill mechanism already works end-to-end; this is a latency tightening, not a correctness fix.

**Origin:** v0.1.1 release audit, 2026-04-29.

---

## BUG-003: First-fit cell measurement off-by-one causes claude-code mid-word wrap on fresh terminal open

**Symptom.** Open a terminal for the first time in a vault with no saved bottom-dock pane width (e.g. a fresh / cold-install vault). Run `claude`. Claude Code's TUI welcome card lays out a panel that overshoots the rendered terminal width by 1–2 columns, so the terminal hard-wraps mid-word — `your g\nateway's`, `with our over\nallClaude`, etc. The right panel `|` edge falls off the visible right side. Self-heals on the first user resize: dragging the pane edge in or out (even briefly) triggers a fresh fit, after which all subsequent claude launches and redraws lay out correctly with proper truncation.

**Confirmed on:** macOS, Obsidian 1.12.7, plugin commit `b9e13fc` (v0.1.1 audit, 2026-05-03). Reproduced in `/tmp/anvil-coldinstall-v0.1.1/` (zip-installed clean vault). Does NOT reproduce in `Vaultnacious-v2` (real-vault dogfooding) at fresh terminal open — workspace state there has a saved bottom-dock pane width that happens to land in a "good" cell-count zone. Plugin bytes (main.js, styles.css, bin/pty-server, fonts/woff2) are byte-identical SHA256 across both vaults; this is vault-workspace-state-dependent at first paint, not code-version-dependent.

**User impact.** Cosmetic at fresh terminal open. No data loss, no shell breakage. Self-heals on the first user resize. Most users won't notice in steady-state because their saved pane width persists across sessions and only the very first terminal open per vault is affected.

**Root cause (suspected).** `XtermHost.mount()` calls the FitAddon's `fit()` immediately after attaching xterm to the DOM. `fit()` measures cell width via a hidden DOM probe and computed-style readout. `main.ts` `await`s `registerBundledFont()` before `registerView()`, so by the time mount() runs the FontFace is registered with `document.fonts` and its status is `loaded` — but there's a one-frame lag before the layout engine actually re-flows pending nodes with the newly-registered font's metrics. The probe reads pre-flow metrics (from the next-priority Nerd Font in the stack, typically a system-installed Meslo/FiraCode/JetBrains/etc.), which are slightly different cell widths than the bundled `Symbols Nerd Font Mono`. The cols/rows reported to pty-server, and thus to claude via $COLUMNS/TIOCGWINSZ, is off by 1–2. Any subsequent fit (ResizeObserver fire from a real resize) measures cleanly because the layout has long since flowed.

**Distinct from FI-019 / fit-coalescer.** FI-019 (commit `f1c8fa1`) coalesced redundant `fit()` calls — the mount-time fit and the immediately-following ResizeObserver firing with identical dimensions. That fix made sure the SAME measurement isn't sent twice. BUG-003 is about the FIRST measurement being inaccurate due to font-flow timing, regardless of whether it's sent once or many times.

**Why current tests don't catch it.** No e2e test asserts character-precise visual layout in xterm output against an expected cols. The visual e2e in `tests/e2e/nerd-font-glyphs-visual.e2e.ts` checks glyph rendering, not text-flow-versus-cols. The fit-coalescer unit tests assert behavior under matched dimensions, not absolute correctness of the dimensions themselves.

**Suggested fix paths (untested, ranked by simplicity).**

1. **Cheap.** In `XtermHost.mount()`, replace the immediate `fit.fit()` with `document.fonts.ready.then(() => fit.fit())`. The promise resolves after pending font loads have flowed into the layout engine. May still race with the very-first paint but should be reliable for any subsequent mount.
2. **Belt-and-braces.** Schedule a second `fit()` via `requestAnimationFrame` (or two RAFs to be safe) after the initial mount-time fit. The fit-coalescer will suppress it as redundant if measurements agree, and dispatch a corrective resize if they don't. Cost: at most one extra resize message on first mount.
3. **Surgical.** Track font-load completion explicitly in the plugin and emit a per-host `relayout()` notification once `document.fonts.ready` has resolved AFTER the bundled font is registered. Each mounted host re-fits on receipt.

**User impact of fix:** for fresh-vault first-open users, claude renders correctly on the first try. For everyone else, no observable change.

**Origin:** v0.1.1 release audit, 2026-05-03 — surfaced in cold-install audit step (d).

---

## BUG-004: Orphaned `pty-server` survives `pkill -9 Obsidian` indefinitely

**Symptom.** Force-kill Obsidian via `pkill -9 Obsidian` (or any path that bypasses Obsidian's normal unload — OS shutdown, app crash, killed-by-OOM, etc.). The shell child of pty-server gets reaped (pty-server's session loop sees the WebSocket close on Obsidian's death and SIGKILLs its child). But `pty-server` itself returns to its `listener.accept()` loop and stays there forever waiting for a connection that will never come. The handoff's MT-013 expectation ("≤ 5 seconds — macOS launchd SIGKILLs orphan children of a dead parent quickly") is empirically false on macOS — orphans linger indefinitely. The 21 zombie pty-server processes cleaned up at the start of the v0.1.1 audit (some over 24 hours old, from prior dogfooding sessions) are direct evidence. MT-013 reproduced cleanly during the audit on 2026-05-03.

**Confirmed on:** macOS 24.6.0 (Darwin), Obsidian 1.12.7, plugin commit `aa12c54`. Reproduced 2026-05-03 in the cold-install vault: pty-server PID 45271 still alive 1+ minute after `pkill -9 Obsidian`.

**User impact.** Cumulative: each force-quit / crash leaves an idle pty-server consuming a TCP listening port and ~2-4MB of RAM. Negligible per-incident. Becomes visible only over weeks of force-quit-pattern usage as a process-table accumulation. Also a contributing factor to BUG-002's "more zombies = worse SIGTERM-vs-WS-flood pass rate" finding (more loaded process table → slightly slower kill propagation when the user later closes a tab the normal way).

**Root cause.** `pty-server`'s parent process is Obsidian. When Obsidian dies abruptly, the JS-side `PtyBackend.close()` chain — which is what normally sends `SIGTERM` to pty-server — never executes. pty-server has no parent-death watchdog (no Linux `PR_SET_PDEATHSIG` equivalent on macOS, and no manual kqueue / polling-on-PPID equivalent installed). Its session loop correctly handles the WebSocket close (kills the child shell, returns from `handle_client`), but the outer accept loop doesn't know that "no client will ever connect again" and waits forever.

**Distinct from BUG-002.** BUG-002 is post-SIGTERM latency under WS-flood — JS sends SIGTERM, pty-server receives it, takes 1-3s to act. BUG-004 is the pre-SIGTERM gap — JS never sends SIGTERM at all, pty-server has no signal to act on.

**Why current tests don't catch it.** The wdio-obsidian-service harness terminates each Obsidian instance through its own controlled shutdown path, which exercises a different cleanup chain than `pkill -9` does. AC1 in `phase-3-hygiene.e2e.ts` covers in-process plugin disable+enable, not host-process death. No e2e test simulates `kill -9` of the Obsidian process tree.

**Suggested fix paths.**

1. **Surgical (macOS-specific).** In pty-server's `main()`, install a kqueue watcher on the parent PID via `EVFILT_PROC | NOTE_EXIT`. When the watcher fires, `shutdown.trigger()`. ~30 lines of unsafe Rust + libc, no extra dependencies.
2. **Cross-platform.** Periodic polling of `getppid()` — if it returns 1 (init/launchd), the original parent is gone, exit. Slower to react (poll interval) but no platform-specific code.
3. **Inactivity-based.** pty-server exits after N minutes without an active client connection. Conceptually weaker (a long-pinned-but-quiet session would die) but simplest to implement.
4. **Ride-along.** Pair with a future "persistent session" feature (FI-005) where the pty-server is intentionally long-lived and its lifecycle is owned by something other than Obsidian.

Path 1 is the recommended fix. macOS-only is fine — the plugin is macOS-only.

**Origin:** v0.1.1 release audit, 2026-05-03 — surfaced in MT-013 manual hygiene + cleanup of historical zombies during audit step (a).
