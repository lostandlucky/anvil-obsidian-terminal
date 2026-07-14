# Known Bugs

Open bugs tracked outside the future-ideas backlog. These are confirmed defects with concrete repros, not deferred features.

Entries follow the same conventions as `future-ideas-backlog.md`: stable ID, append-only, remove on fix. Use `BUG-###`.

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
