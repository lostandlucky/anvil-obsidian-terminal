# Meta-Plan: Shippable Plugin

## Context

The original Phase 4 of `../terminal-mvp/meta-plan.md` was superseded on 2026-04-16, with its scope decomposed into FI-014 through FI-020 in `../future-ideas-backlog.md`. The first follow-up meta-plan (`../pane-chrome-and-picker/meta-plan.md`) shipped FI-010, FI-012, and FI-014. This is the second follow-up meta-plan, picking up the remaining six features that, taken together, transition the plugin from a dev-env artifact for Steve into a thing other humans can install and use: `FI-015` (Settings tab), `FI-016` (theme integration), `FI-017` (release packaging), `FI-018` (process hygiene audit), `FI-019` (resize polish), `FI-020` (dependency audit).

Six features is too many for one meta-plan to track loosely; they pair naturally into three phases that share a surface and reduce orchestration overhead. The pairings reflect real coupling: settings without theming has nothing meaningful to expose; release without hygiene is a real-user footgun; resize polish and dep audit are independent groomings best done together as a clean baseline before the bigger work.

**Filing:** Lives in its own subfolder per `_shared-v2/artifact-organization.md`, same convention as the prior follow-up meta-plan.

## Scope

**IN:**
- FI-019 — clean resize, no double-fit, no layout flicker
- FI-020 — audit pinned `wdio-obsidian-service`, Obsidian test binary, set up Cargo Dependabot, re-verify three undocumented Obsidian APIs
- FI-015 — real Obsidian Settings tab covering shell selection, additional shells, `preserveTmuxDimensions` plumbing, optional theme overrides, tmux session naming, **font family + size (closes FI-021 nerd-font support)**
- FI-016 — terminal reads Obsidian CSS variables; theme follows light/dark/community themes live
- FI-021 — nerd-font compatibility (folded into FI-015's font-family setting; see backlog)
- FI-018 — process hygiene audit covering force-quit, plugin reload mid-session, Obsidian crash, `pty-server` crash, hung shells, multi-terminal abnormal exits
- FI-017 — codesigned + notarized macOS arm64 GitHub release artifact (build + tag locally; publication is a deliberate manual step, not automated by this work)

**OUT:**
- FI-005 — persistent terminal session across close/reopen (deferred per backlog)
- FI-011 — Windows/Linux compatibility (deferred per backlog; FI-015 only carves the *future* home for the skip-list, doesn't ship it)
- Community plugin store submission — manual install only per ADR-0002
- Any new terminal *features* — this body of work is shipping what already exists, not adding capability

## Shared Constraints

- **`TerminalBackend` interface MUST NOT be widened.** Per-view config flows through `TerminalView.setState`/`getState` with a typed launch spec — confirmed-working pattern across Phases 2b/3/3.5 and the pane-chrome work. Settings additions in P2 must respect this seam.
- **Undocumented Obsidian APIs need feature-detect + graceful-degrade.** Five already exist in production: `rootSplit.setDirection`, `workspace.createLeafInParent`, `SuggestModal.chooser.setSelectedItem`, the workspace-container `createLeafBySplit` hijack from ADR-0007, and `WorkspaceTabs`-adjacent calls. Anything new from P2 (theme-change events, settings-tab APIs) joins that set. Canonical pattern: try, detect, fall back without crashing.
- **CSS authoring goes in `src/styles.css`.** That file is the hand-authored source. `esbuild.config.mjs` bundles xterm's CSS in front of it and minifies into the deployed `styles.css` at the repo root. Don't hand-edit the deployed file — it's overwritten on next build.
- **macOS arm64 only.** Inherited from parent meta-plan; FI-017 ships a single-arch artifact, FI-018's hygiene audit only needs to be honest about macOS, not all platforms.
- **Dependency-maintenance cadence per `CLAUDE.md`.** P1's FI-020 is the overdue kickoff; the recurring cadence in CLAUDE.md governs everything after.
- **No backwards-compat shims.** Plugin isn't published, all consumers in-tree, refactor freely. Inherited from prior meta-plans.

## Dependency Map

```
Phase 1 (grooming) → Phase 2 (settings & theming) → Phase 3 (release-readiness)
```

Strictly sequential. P1 sets a clean baseline (current deps, no resize jitter) before P2 builds new UI against it; P3's release packaging needs the hygiene audit to honestly claim "nothing leaks." Within P1, FI-020 runs before FI-019 so any Obsidian binary version bump from the audit lands before resize work tests against it. Within P2, FI-016 runs before FI-015 so the settings tab has a theming model to expose overrides for. Within P3, FI-018 runs before FI-017 so the release ships a hygiene-verified plugin, not an aspirational one.

---

## Phase 1: Grooming

**Goal:** Set a clean baseline before the larger work in P2 and P3 builds on top. The dependency audit happens first inside the phase — bump pins, set up Cargo Dependabot, re-verify the undocumented-API surface — and any Obsidian-binary version change lands before resize work tests against it. Then the resize double-fit issue, deferred since Phase 1 of terminal-mvp, gets identified and either removed or documented as load-bearing. By end of phase, the dep posture matches reality and the resize behavior is honest.

**Dependencies:** None (this phase clears the runway).

**Success criteria:**
- `wdio-obsidian-service` and Obsidian test binary pin decisions made deliberately (bump or defer with recorded rationale)
- Cargo Dependabot or Renovate active against `pty-server/Cargo.toml`
- Three undocumented Obsidian APIs (`rootSplit.setDirection`, `workspace.createLeafInParent`, `SuggestModal.chooser.setSelectedItem`) re-verified against the active pinned binary; any drift surfaced with a fix or a recorded blocker
- The redundant xterm fit on resize is either removed (with a regression test) or its load-bearing reason documented inline
- All existing unit + e2e tests stay green after dep bumps

**Risk flags:**
- Major-version bump of `wdio-obsidian-service` could change harness API surface — defer if migration cost exceeds value
- Obsidian test binary at "current stable" may not exist yet — staying ~1 minor lagging is acceptable per CLAUDE.md
- Removing the double-fit may turn out to surface a real layout bug; the fallback ("document why it's load-bearing") must be available rather than forced
- Cargo Dependabot config syntax differs from npm — verify the YAML actually triggers a PR after first push

---

## Phase 2: Settings & Theming

**Goal:** Users get a real Obsidian Settings tab AND the terminal visually belongs inside Obsidian. Theming ships first inside the phase: terminal reads Obsidian CSS variables at mount, maps them to xterm's theme object, re-renders on theme change. Then the Settings tab lands with shell selection, additional shells list, the `preserveTmuxDimensions` toggle finally plumbed into the spawn path, optional theme overrides exposed for advanced users, and tmux session naming format. By end of phase, "this is the user's tool" is true in a way it isn't today — both visually and behaviorally.

**Dependencies:** Phase 1 complete.

**Success criteria:**
- Terminal background, foreground, and ANSI palette derive from Obsidian CSS variables; default Obsidian themes (dark, light, default) all render the terminal coherently
- Theme change event triggers a live re-render — no plugin reload required
- A native Obsidian Settings tab is registered and exposes at minimum: default shell selection from discovered shells, custom additional-shells list, `preserveTmuxDimensions` toggle, tmux session naming format, font family (with a sensible nerd-font-preferring CSS stack default), font size
- Nerd-font glyphs (Powerline range + U+E000–U+F8FF Private Use Area) render correctly when a nerd-font is installed and selected — this closes FI-021
- `preserveTmuxDimensions` toggle, when enabled, actually adjusts the `tmux attach-session -x/-y` args at spawn — closing the Phase 3 gap
- `TerminalBackend` interface unchanged; settings flow through the established `setState`/`getState` launch-spec pattern
- Settings persist across plugin reloads via Obsidian's `saveData`/`loadData`
- Theme override hooks exist in the settings model for future use, even if the UI exposes them minimally

**Risk flags:**
- Obsidian's `css-change` workspace event surface may not exist on the pinned binary — fall back to `MutationObserver` on `document.documentElement.classList`
- ANSI 16-color palette is a real design call (adopt Obsidian accents vs. ship a default like Solarized) — phase spec must pick one, with override path for FI-015
- Settings tab persistence races on plugin first-load (data not yet loaded when tab is registered) — prior plugins solve this with `await loadData()` in `onload` before `addSettingTab`
- Tmux session naming format with placeholders (`{date}`, `{vault}`) is feature creep — keep options concrete (fixed prefix, integer, timestamp) unless a clear use case appears
- "Hide Anvil chrome" and FI-011's skip-list are out of scope but the model should leave room for them — over-engineering risk if the model goes too generic

---

## Phase 3: Release-readiness

**Goal:** A real human can install this plugin from a GitHub link and use it without dev-env knowledge. The hygiene audit happens first inside the phase: open and close many terminals, force-quit Obsidian mid-session, kill `pty-server` directly, reload the plugin while shells are running, and verify nothing leaks; fix anything that does, and extend e2e + manual-test coverage to lock the new state in. Then the release artifact: codesigned and notarized `pty-server` binary, bundle layout that places `bin/pty-server` correctly after install, Cargo dependency hygiene confirmed from P1, GitHub release built and tagged locally. Publication (pushing the tag, uploading to GitHub Releases) is a deliberate manual step — the phase does not push.

**Dependencies:** Phase 2 complete.

**Success criteria:**
- Process hygiene audit covers force-quit, plugin reload mid-session, Obsidian crash simulation, `pty-server` crash, hung shells, multi-terminal abnormal exits — each scenario has an automated e2e test or a documented manual-test entry
- No discovered leak ships unfixed; any unfixable scenario is recorded as a known-limitation entry with mitigation
- `pty-server` binary is codesigned and notarized with a recorded Developer ID, OR the install docs explicitly carry the `xattr -d com.apple.quarantine` workaround as the chosen UX (decision happens in the phase spec)
- A GitHub release artifact zip is produced locally with `main.js`, `manifest.json`, `styles.css`, and `bin/pty-server` in the layout Obsidian's plugin install path expects
- Either: a test confirms `obsidian-launcher` (or the install path Obsidian uses) places `bin/pty-server` correctly after install, OR a runtime fetch/extract fallback exists for cases where it doesn't
- Cargo Dependabot from P1 has surfaced any pending bumps; release ships with current pins
- A version tag is created locally; nothing is pushed to GitHub
- The Required Manual Verification section of the completion report includes the steps Steve takes to actually publish (push tag, draft release, upload artifact)

**Risk flags:**
- Codesigning/notarization needs an Apple Developer account — if Steve doesn't have one, the phase falls back to the `xattr` workaround path automatically rather than blocking
- The notarization pipeline is async (Apple can take minutes to hours) — don't gate the phase's GREEN on a successful notarization round-trip; ship the script, run it, accept that the published release happens later
- `obsidian-launcher` only copies the manifest-declared files (`main.js`, `manifest.json`, `styles.css`) per Phase 2b notes — the `bin/` directory may not travel; if so, runtime fallback is the path
- Hygiene audit may surface a leak that's expensive to fix (e.g., requires changes to `pty-server`'s WebSocket lifecycle) — the phase is allowed to record it as known-limitation rather than fixing if scope explodes

---

## Verification

After each phase, the plugin should still build cleanly via `npm run build`, all unit + e2e tests pass, and a fresh manual install into a vault should exhibit the new behavior without breaking prior phases. After Phase 3, a clean machine install (no dev tooling) from the locally-built release zip should work end-to-end up to the point of "Steve clicks publish."

## Self-Check Notes

**Goldilocks:** Phase goals are 3–5 sentences; success criteria stated as outcomes, not implementation steps.
**Substitution:** Each phase has multiple viable means — P1's resize fix has remove-vs-document branches; P2's theme-change detection has multiple Obsidian API paths; P3's signing has signed-vs-documented-workaround branches.
**Discovery:** Phase specs need real investigation — P1 must inspect actual dep-pin diff, P2 must read Obsidian's CSS variables and decide the palette, P3 must verify what `obsidian-launcher` actually copies.
**Stability:** If P1 surprises (e.g., resize fix turns out to need a layout-engine change), P2 and P3 still hold — the goals are independent.
**Independence:** P2 and P3 cannot reorder (release-without-settings ships an incomplete plugin) but the FI pairings within each phase are flexible if exec discovers a better order.
**Anti-pattern check ("stealing the sub-plan's job"):** No file paths in goals beyond what's already stable from prior phases. No method bodies. Open design questions flagged, not pre-answered. Phase specs will pick.
