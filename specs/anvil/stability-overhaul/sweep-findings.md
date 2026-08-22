# Stability Sweep Findings — 2026-08-22

Evidence base for [`meta-plan.md`](./meta-plan.md). Produced by two parallel sweep agents (project-history inventory; architecture/fragility map) plus a live incident diagnosis, all on 2026-08-22. Phase specs should mine this rather than re-derive it. File:line refs are as of `autopilot/bug-sweep-2026-07-14` @ `8e77d50`.

## The triggering incident (diagnosed live)

Terminal pane frozen after wake. Verified state: pty-server (spawned 8:30 AM by the Obsidian renderer) alive but **shell dead and no client connected** — back in its accept loop on `localhost:52096`. `pmset -g log` showed maintenance-sleep cycles with wifi flapping and a real wake at 10:51:49; `~/.zsh_history` flushed at 10:52 (shell exiting). Mechanism: Chromium's network service kills sockets — loopback included — on network-change events (`ERR_NETWORK_CHANGED`); `PROTOCOL.md`'s kill-on-close then killed the shell; the view printed one yellow `[shell exited: status ?]` line (user confirmed) and went inert. Not a stale build (installed main.js + binary byte-identical to the July 14 build), not a crash (no diagnostic reports), not GPU (GPU helper up since Aug 11).

## Project state

1. **All recent work is off `main`.** `origin/main` @ `3c05705`; all 80 subsequent commits — v0.1.0 + v0.1.1, glyph-rendering/WebGL, settings/theming, release scripts, the entire BUG-001..004 sweep — exist only on `autopilot/bug-sweep-2026-07-14`. `origin/main` has no `restore-redock.ts`, `settle-fit.ts`, `webgl-loader.ts`, `bundled-font.ts`; manifest still 0.1.0.
2. **Bug-sweep fixes never human-verified.** All 7 `MORNING-UAT.md` items open; every process-hygiene checklist row (MT-013..MT-018) has an empty run log (`manual-test-checklist.md:198,209,220,227,234,241`).
3. **FI-020 dependency audit overdue** (deferred twice; CLAUDE.md mandates monthly): 9 open Dependabot PRs, oldest the wdio e2e-harness group (#12, since 2026-05-18); `wdio-obsidian-service` 3.0.2 vs 3.2.0; `obsidian` types 1.12.3 / test binary 1.12.7 vs 1.13.1 stable; TypeScript major (#33) open. FI-020 also owns re-auditing undocumented Obsidian API drift.
4. **Backlog hygiene:** FI-019 and ~7 other FI entries are stale (already shipped) despite the file's remove-on-fix rule. FI-023/24/25 exist only as uncommitted working-tree edits.

## Closed-bug history (BUG-001..004, fixed 2026-07-14, unattended)

- **BUG-001** restore-path redock: Obsidian's `getLayout()→changeLayout()` loses the wrap-and-dock structure; fixed via `src/dock/restore-redock.ts` stray-classification + `reconcileRestore()` (`src/main.ts:456`), `WeakSet` identity to distinguish restore-strays from user drags.
- **BUG-002** SIGTERM under WS flood: session loop parked in `ws_sink.send().await` to a zero-window peer (~5s, unbounded in principle); fixed with nested `biased` select racing shutdown, 250ms goodbye budget, `drop(out_rx)`. Post-fix max 271ms over 24 runs.
- **BUG-003** first-fit off-by-one: mount-time fit before late `FontFace` flow + FitAddon reading cached cell dims (silent no-op at unchanged container size); fixed via `settle-fit.ts` one-shot corrective pass + forced `_charSizeService.measure()`. The bug entry's own fix paths 1–2 could never have worked (recorded).
- **BUG-004** orphaned pty-server after `pkill -9`: "launchd reaps orphans" was empirically false (21 zombies found, 24h+ old); fixed with kqueue `EVFILT_PROC|NOTE_EXIT` parent-death watchdog on a detached thread, getppid re-checks around registration, explicit no-idle-reaping requirement (user-named). **Load-bearing discovery: a broken stderr pipe made `eprintln!` panic the thread holding the shutdown trigger — hence trigger-before-log on every death path + `BestEffortStderr`. Invariant: a log line must never be able to kill the exit path.**

## Fragility inventory (F1–F14)

- **F1 · critical — `readPort` can hang forever.** `src/pty/pty-backend.ts:81`: `stdout.once("end", () => clearTimeout(timer))` — if the child's stdout ends before a port line (clap usage error, corrupt binary, instant death), the 5s watchdog is cleared *without resolving*; `backend.start()` and `addTab` await forever, silently.
- **F2 · high — stderr piped, never read.** `pty-backend.ts:41` opens the pipe; nothing drains it. Rust `tracing` writes block a tokio worker when the 16–64KB pipe fills. ~5 INFO lines/session normally, but two unbounded `warn!` paths (malformed frame `main.rs:462`, resize failure `main.rs:458`). `BestEffortStderr` swallows errors, not blocking writes.
- **F3 · critical — the incident.** No reconnect; mid-session `ws.onerror` is a no-op (promise already resolved); `write()`/`resize()` silently no-op on non-OPEN socket; `closed` latch stays false so the orphaned pty-server keeps listening until leaf close or parent death.
- **F4 · high — teardown bypass.** `main.rs:433` `?` on ws-receive error returns from `handle_client` past `killer.kill()`, `drop(out_rx)`, reader join, goodbye (shell survives if it traps SIGHUP). Same shape at `main.rs:96`: transient accept errno kills the whole server.
- **F5 · high — no keepalive either direction.** Half-open TCP undetectable; client writes are keystroke-driven, so an idle dead pane looks live indefinitely. Why F3 presents as "frozen" instead of "reconnecting…".
- **F6 · medium — WebGL context loss.** Addon waits 3s frozen before `onContextLoss` fires → `dispose()` → DOM fallback *does* re-render, but the downgrade is permanent (restore listener unregistered with the addon) and invisible to the entire suite (e2e reads the buffer, not DOM rows — deliberately).
- **F7 — silent output drops.** `pty-backend.ts:96-97` drops undecodable frames with no counter/log → escape-state desync with no diagnostic trail.
- **F8 — reconnect today = fresh shell.** Accept loop does come around, but `handle_client` runs full openpty+spawn against `args.clone()` — original argv cols/rows, no scrollback, new shell. **Server needs a detach/reattach session model before any client reconnect logic.** Retry loops also queue in the TCP backlog during teardown, deepening the illusion.
- **F9 — exit fidelity zero.** `exit_status` populated only via the `wait_handle` arm; shutdown and ws-close paths send `{status: null, signal: null}`; `signal` is always null by protocol. Every abnormal end renders as `[shell exited: status ?]`.
- **F10 — 34 `catch {ignore}` sites.** Worst converters: `main.ts:488` (partial detach loop → terminal silently vanishes, no retry because stray marked placed pre-detach), `view:133/138/384/389` (`backend.close()` throw → orphan — the leak path the trend log exists for), `xterm-host.ts:183` (all fit failures invisible), `wrap-and-dock.ts:97,102,124` (malformed split on partial unwind), `theme.ts:118` (all colors fall back silently).
- **F11 — fit/resize edges.** Coalescer keys on container dims only (blind to cell-metric changes — `refreshThemeAndFont` must call `fit()` directly); `onResize` fits only the active tab (background `vim`/`tmux` mis-sized until switched); settle-fit is one-shot (spent pass = BUG-003 returns, no retry); `restoreHeight` writes undocumented `leaf.dimension` internals unguarded — a throw fails `onOpen`.
- **F12 — restore paths.** `reconcileRestore` rests on WeakSet object identity (an Obsidian change recreating leaf objects → running shells detached as "strays"); restore spawns fresh shells (FI-005, same failure class as F3 from the user's seat); **no test simulates real quit-and-relaunch with persisted workspace.json** — both prior restore bugs slipped through exactly this gap; the "Loading workspace…" hang is latent and uncovered (MT-016 watch).
- **F13 — install seam.** `binary-check.ts:25` checks existence only — a quarantined binary passes, then fails at spawn into F1's shape. Binary unsigned; dev builds strip quarantine so the user-facing failure can't repro in dev.
- **F14 — orphan backstop is single-layer.** The kqueue watchdog (well-built, correctly refuses to guess) covers parent death only — not F3's leaked listener, not swallowed close-throws, not hung starts. The orphan trend log (`logs/orphan-pty-server-counts.log`) is non-gating and shows 1→6→4→5 in the real vault.

## Recurring themes (159 commits)

- **A. Process-lifecycle ownership is the deepest fault line.** BUG-002/004, F3/F5/F8/F14, FI-005, FI-018, and the dropped AC8 are one problem from different angles. Every fix so far *tightened* the renderer coupling; BUG-004's notes named inverting it as the strategic move.
- **B. Timing/ordering races at every layer** (FI-009 setState/onOpen, PROMPT_EOL_MARK mount ordering, FontFace vs layout, kqueue registration race). Lesson recorded repeatedly: explicit sequencing beats more await.
- **C. Blocked writes to gone readers are the house latent-hang** (BUG-002 ×3, BUG-004's stderr panic, F2).
- **D. Silent degradation is house style with no degraded-mode surface** (5 feature-detect fallback sites; `__anvilFallbackWarned` unread).
- **E. Tests asserting the adjacent thing** (bundled-font post-mortem: 5 green tests, feature inactive; FI-007; MT-002's invalidated ✅). Rule: pair "config in place" tests with "resolves end-to-end" tests.
- **F. Environment-dependent repros** (BUG-003 vault-state, BUG-002 zombie-load-dependent flake — BUG-004's orphans made BUG-002 worse).
- **G. Renderer swaps silently invalidate test infra** (WebGL emptied `.xterm-rows`; standing rule: read `terminal.buffer.active`, never DOM rows).

## Watch items / latent risks

Latent "Loading workspace…" relaunch hang (uncovered, MT-016); three reconcilers on one `layout-change` event (interaction untested as a set); height persistence rests on `leaf.dimension` internals (`setDimension` is a noop in 1.12.7); R8e — Anvil cannot veto being clobbered by leaf-stealing plugins (Mononote, Hover Editor; tmux is the documented workaround); 5 undocumented-API seams with silent degradation; `allowSingleChild` orphan-wrapper risk on partial unwrap; PROMPT_EOL_MARK mount-ordering tripwire; `preserveDrawingBuffer=false` is deliberate (trail artifacts otherwise); MT-010 permanently half-done; release SHA256 non-reproducible; binary unsigned.

## Test coverage posture

Levels: 1 = vitest (obsidian-free), 2 = wdio + real pinned Obsidian (default), 3 = manual last resort. Last green gate: unit 244/244, e2e 14/14 files, cargo 7/7, clippy clean.

- **Level-1 harness is stronger than its label:** `parent-death-watchdog.test.ts` and `sigterm-latency.test.ts` build the release binary via cargo and speak the WS protocol from vitest — the only harness that can kill parents, measure exit latency, or drive adversarial peers. Reusable for all Phase 2 lifecycle work without wdio.
- **E2E structural ceiling:** one Obsidian per spec, ephemeral vault — cannot relaunch/kill the host, no cold-vault state, no real pointer drags, nothing visual. Every bug-sweep phase invented a partial substitute covering the mechanism, not the production condition.
- **Manual reality:** MT-013..018 never run; MT-015 (hung shell ignoring SIGTERM) is genuinely unaddressed in code — nothing escalates to SIGKILL. Three picker e2e tests silently `this.skip()` without tmux on PATH. Phase-3 AC7 overlay matrix (declared ship-blocker) has no recorded result.

## Seams for the rework

- **`TerminalBackend`** (`src/pty/terminal-backend.ts`) — the right seam; view touches the backend only through it. Missing: `onStateChange(connecting|open|reconnecting|dead)` and `restart()`. Two implementers only.
- **Transport is swappable in one method** — `connectSocket` (`pty-backend.ts:85-108`) is the only `WebSocket` construction; esbuild leaves Node builtins external, so Node `net`/UDS transports are reachable with no build changes.
- **Missing injection points:** the view hard-`new`s `PtyBackend` (`view:297`) — a backend factory is the prerequisite for testing dead-tab/reconnect UX below full e2e; `MockBackend` needs `emitDisconnect()`; `createXtermHost` is called directly (`view:290`); `readPort` takes a `ChildProcess` (extracting a Readable-based PortDiscovery makes F1 a two-line unit test).
- **Already-injectable:** `webgl-loader` (factory + warn sink — context-loss policy trivially changeable and testable), `settle-fit` (fontsReady + requestFrame injected), `restore-redock` (pure).

## cmux reference (user-named benchmark)

`com.cmuxterm.app` 0.64.19, native Swift/AppKit on **libghostty** (repo: manaflow-ai/cmux, AGPL-3.0). PTY owned in-process; no network hop in the session path; Sparkle updates; sessions survive sleep trivially and die on app quit. Transferable lessons: session path off any network stack; session lifetime owned outside the fragile/reloadable layer; visible per-session status surface (sidebar state icons driven by hooks). Code is not transferable (license + language).
