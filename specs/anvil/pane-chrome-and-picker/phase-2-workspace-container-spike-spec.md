# Phase 2: Workspace Container Design Spike — Spec

Meta-plan reference: [meta-plan.md](./meta-plan.md) Phase 2 (lines 67–82). FI-012 reference: `specs/anvil/future-ideas-backlog.md` lines 16–29. FI-014 reference: `specs/anvil/future-ideas-backlog.md` lines 83+.

## Objective

Decide the structural approach that lets the terminal render inside a native Obsidian container (with tabs, close X, drag handle, editor-status-overlay displacement) and lets the dock open without flattening existing `rootSplit` column layouts. Record the decision as an ADR. Prove the chosen API path runs against Obsidian 1.12.7 with a throwaway prototype. The output is a commitment, not a product — Phase 3 implements against it.

## Diagnostic Flags Against the Meta-Plan

- **Goldilocks ✓** — Phase 2 goal is 3 sentences; success criteria are outcomes.
- **Substitution ✓** — multiple approaches genuinely viable: unified FI-012+FI-014 fix vs. independent fixes; tab container via `WorkspaceTabs` vs. custom chrome; `rootSplit.createSplit` vs. manual child reparenting.
- **Discovery ✓** — spike IS the investigation; you cannot pre-plan the ADR without running code against Obsidian 1.12.7 internals.
- **⚠️ Meta-plan ADR number is stale.** Meta-plan line 74 says "likely `docs/adr/0005-workspace-container.md`" but `0005` is already taken by [0005-picker-section-labels-as-decorated-siblings.md](../../../docs/adr/0005-picker-section-labels-as-decorated-siblings.md). This spec targets `docs/adr/0006-workspace-container.md`. Meta-plan can be corrected separately; this spec proceeds with `0006`.

## Decisions

### D1. Spike framing: unified fix vs. two independent fixes **[RESOLVED → A with judgment-based pivot]**

Two ways to frame the investigation:

- **A. Unified fix (recommended).** Investigate whether wrapping the terminal in a tab container under `rootSplit` subsumes FI-012 naturally — i.e., the wrapper's presence means the dock never needs to flip `rootSplit.direction`, so existing columns can't flatten. One structural change answers both FIs. Risk: if the wrapper approach doesn't work cleanly against 1.12.7, the spike pivots late and we've burned time investigating the wrong framing first.
- **B. Two independent investigations in parallel.** Investigate FI-012's `rootSplit.createSplit()` candidate (wrap-existing-children-then-dock) and FI-014's tab-container candidate as separate questions. Risk: even if both work, we may miss the elegant single-change answer and ship more surface than needed.

Framing A is structurally correct if it works — one container change answers both FIs with less surface to maintain. B is a hedge. Default to A with an explicit pivot signal: if the agent judges (per D4) that the wrapper approach is unlikely to preserve columns OR unlikely to group subsequent terminals as tabs, split into B and investigate the two halves separately. The pivot fires on judgment, not on a clock.

Accepted: **A with judgment-based pivot.** Investigate unified fix first; if the agent judges (per D4) that the wrapper approach is unlikely to preserve columns OR unlikely to group subsequent terminals as tabs, split into B and investigate the two halves separately.

### D2. Pre-decided ranked fallbacks **[RESOLVED → ranking below accepted]**

Rank fallbacks BEFORE the spike, commit to the top-ranked reachable one if the primary path fails. This prevents negotiating the fallback under the decision fatigue of a long investigation — the ranking is set while minds are fresh.

**Every option below is gated on D8 tab-isolation** (see R8). If a rank passes the prototype demos (D3 a/b/c) but regresses D8 (probe d), it is disqualified and the spike investigates the next rank. Proposed ranking, top to bottom:

1. **Native tab container under `rootSplit`.** `WorkspaceTabs` or equivalent Obsidian internal. Terminal gets native chrome + native tab grouping for free. **D8 risk:** if Obsidian's note-targeting logic treats the container as a valid target for `openLinkText` / drag-drop, this option is disqualified.
2. **Custom chrome around a native `WorkspaceSplit` of per-terminal leaves.** Plugin renders its own tab strip over a standard split; terminals are real child leaves. Partially native (real leaves support Obsidian drag/reorder, keyboard shortcuts). **D8 risk:** similar to option 1 — Obsidian may target the split for note placement.
3. **Single leaf with custom in-DOM tab multiplexing.** One leaf under `rootSplit` (as today), plugin renders its own tab strip inside; "tabs" are multiplexed xterm instances swapped via the view's own state. D8-safe by construction — matches the current single-leaf isolation. **Trade-off:** loses Obsidian's native tab affordances (drag-to-reorder, Cmd-1/2/… switching, right-click context menu). Plugin re-implements whichever affordances FI-014 requires.
4. **One container per terminal, no tab grouping.** Each terminal is its own leaf with today's chrome. Loses FI-014's "tabs in one container" property entirely; keeps isolation as today.
5. **Defer FI-014 structurally, ship FI-012 alone.** No new container; just fix the flatten via `rootSplit.createSplit` or equivalent. FI-014 returns as its own future meta-plan.

The spike is not obligated to investigate every option. It investigates in rank order until one passes both the D3 prototype demos and the D8 isolation gate, then commits.

Accepted: ranking as written.

### D3. Prototype success bar **[RESOLVED → (a), (b), (d) required; (c) nice-to-have]**

Meta-plan names two demos:

- (a) one terminal view in a tab container under `rootSplit`
- (b) a second terminal view as a tab in that same container

Proposed additions:

- (c) with two horizontal note columns already present, opening the dock leaves the columns side-by-side and adds the terminal container below as a full-width row
- (d) **D8 tab-isolation probe:** with the terminal container open, a note opened via `workspace.openLinkText` (default, `"tab"`, and `"split"` modes) and a synthetic note drag-drop onto the terminal container do NOT place the note inside the terminal's container. Mirrors the four probes in `tests/e2e/tab-isolation.e2e.ts`.

(c) is the FI-012 half. Including it tests the "unified fix" framing (D1-A) at the prototype level; excluding it makes the prototype a pure FI-014 demo and leaves FI-012 to Phase 3's implementation risk.

(d) is a **required** gate. The spike MUST verify isolation against the D8 probes. If the chosen container regresses D8, the spike drops that rank and adopts the next D2 fallback. See R8 and D7 below.

Accepted: (a), (b), (d) required. (c) is nice-to-have — include if it falls out naturally from the chosen structural approach, but do not spend extra cycles forcing it. If (c) needs its own separate investigation, skip it in this spike and let Phase 3 handle the FI-012 half.

### D4. Spike stopping criterion **[RESOLVED → judgment-based]**

No hard time cap. The spike stops when the executing agent judges that: (a) the reasonable potential solutions for the current rank have been exhausted, (b) the investigation has not hit the D3 (a)/(b)/(d) success bar, and (c) further investigation on that rank is unlikely to be fruitful. At that point, drop to the next D2 rank and repeat. If all ranks are exhausted without success, the top-reachable rank becomes the ADR decision and the ADR explains the gap.

The agent is expected to report progress at natural pause points (after exhausting a candidate API, after a D8 probe passes or fails) rather than burning through the full D2 ladder silently. The user can redirect at any pause point.

### D5. ADR number **[RESOLVED → 0006]**

`0005` is taken by picker-section-labels. This spec targets `docs/adr/0006-workspace-container.md`.

### D6. Prototype location **[RESOLVED → throwaway subfolder]**

Prototype lives at `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` — a subfolder inside the meta-plan's own artifact directory. Clearly not shippable (outside `src/`, outside the esbuild input). Not imported by production code. Deleted or kept for reference at the author's discretion after Phase 3 ships.

## Requirements

R1. **A prototype runs against Obsidian 1.12.7** (the pinned test binary) and demonstrates the chosen structural approach live. If D1-A holds, the prototype shows (a) + (b) + (c) from D3; if the spike falls back to a lower-ranked D2 option, the prototype demonstrates whatever that option can demonstrate, and the ADR explains the gap.

R2. **An ADR at `docs/adr/0006-workspace-container.md` is accepted** (Status: Accepted). It follows the template at `docs/adr/_template.md` and contains, at minimum: Context (linking to this spec and the FI entries), Decision (chosen API path + feature-detect mechanism + named fallback rank), Consequences (easier / harder / reversible analysis).

R3. **The ADR answers each FI-014 open design question explicitly:**
- Tab container vs. custom chrome — which did the spike settle on and why
- Status bar within the terminal container — yes / no / deferred
- Plus-action (new terminal) location — in the tab strip, in the view header, in the command palette only, or some combination
- FI-012 relationship — subsumed by the unified fix, handled as a separate change in Phase 3, or deferred to a future meta-plan

R4. **Any new undocumented Obsidian API surface named in the ADR MUST be compatible with the feature-detect + graceful-degrade pattern at `src/dock/bottom-dock.ts:47–63`.** The ADR names the specific feature-detect predicate(s) (e.g., `typeof rootSplit.createSplit === "function"`) and the graceful-degrade fallback by rank.

R5. **Prototype is clearly throwaway.** Lives outside `src/`, not in the esbuild input, not imported by any production module. The directory contains a `README.md` naming it as a Phase 2 artifact and describing how to run it against a local Obsidian 1.12.7 vault.

R6. **Spike discipline is enforced by the D4 stopping criterion**, not a clock. When the executing agent judges that a rank is exhausted (reasonable candidates tried, success bar not hit, further investigation not likely fruitful), it drops to the next D2 rank. No open-ended investigation on a single rank; no silent burn through the ladder — pause and report between ranks.

R7. **A phase-2 completion report** is written at `specs/anvil/pane-chrome-and-picker/phase-2-completion-report.md` and includes: the framing that actually won (A or B), which D2 fallback rank the decision landed on, named API surfaces Phase 3 will use, and the scope Phase 3 inherits (unified vs split).

R8. **The chosen container preserves D8 tab-isolation.** Notes opened via `workspace.openLinkText` (default / `"tab"` / `"split"` modes) and a synthetic note drag-drop onto the terminal container MUST NOT land inside the terminal's container. This mirrors the four probes in `tests/e2e/tab-isolation.e2e.ts` and is a **hard gate** on every D2 rank. If the primary rank regresses D8, the spike drops to the next rank — no case-by-case exceptions.

R9. **Before code investigation, produce a `/vault-research` note** on prior art for the question "how do apps provide a tabbed UI inside a single container without that container accepting foreign content (e.g., notes being targeted at it)." Candidates to survey: VS Code's integrated terminal panel (custom tab UI inside a fixed host), other Obsidian plugins with multi-instance views (Kanban, Excalidraw), the Termy plugin referenced in ADR-0003, relevant Obsidian forum threads on `WorkspaceTabs` / tab-group isolation, and any terminal emulator (Warp, Ghostty, iTerm2) patterns worth citing. The research note informs the D2 ranking; it does not pre-commit to an option. Save to the vault per `/vault-research` defaults and link from the phase-2 completion report.

## Acceptance Criteria

AC1. **ADR exists and is accepted.** `docs/adr/0006-workspace-container.md` has Status: Accepted, ISO date in header, and the three template sections (Context, Decision, Consequences) non-empty.

AC2. **ADR names the chosen API path concretely.** A reader can identify the exact Obsidian runtime object property or method the Phase 3 implementation is expected to call. Not a vague "use workspace tabs" — a specific named surface.

AC3. **ADR names the feature-detect predicate.** The condition under which the primary path runs is stated in code-level terms (`typeof X.method === "function"`, or equivalent runtime check).

AC4. **ADR names the graceful-degrade fallback by rank.** The ordered list from D2 (or a user-revised ranking) is recorded, and the ADR names which rank was adopted if the primary failed.

AC5. **ADR answers all four FI-014 open design questions from R3.** Each has a stated resolution — Accepted, Deferred, or Not Applicable (with reason). No question is silently skipped.

AC6. **ADR names the FI-012 relationship.** Subsumed / independent / deferred — one of the three, with one sentence of rationale.

AC7. **Prototype runs.** Following the prototype's `README.md`, a reader can launch Obsidian 1.12.7 with the prototype loaded and observe the demos the ADR claims. Binary pass/fail: does the thing the ADR says works actually work in an Obsidian window.

AC8. **Prototype is outside `src/`.** `ls src/ | grep -i prototype` returns nothing. `grep -rn "phase-2-prototype" src/` returns nothing (no production imports).

AC9. **Completion report exists and summarises the spike.** `specs/anvil/pane-chrome-and-picker/phase-2-completion-report.md` names: chosen framing (D1), adopted fallback rank (D2), time spent, Phase 3 scope inherited.

AC10. **No production `src/` files were changed.** `git diff main -- src/` shows nothing. The spike does not modify shipping code. (Exception: if Phase 2 uncovers a bug in `src/dock/bottom-dock.ts` that blocks the spike, flag it and decide with the user whether to patch in-phase or log a new FI.)

AC11. **D8 isolation probes pass against the prototype.** With the prototype loaded: (a) `workspace.openLinkText(note, "", false)` places the note OUTSIDE the terminal container; (b) same for `"tab"` and `"split"` modes; (c) a synthetic HTML5 drag-drop of a note onto the terminal container does NOT place the note inside it. If any probe fails, the ADR records that the chosen rank was disqualified and what was adopted instead.

AC12. **Prior-art research note exists.** The `/vault-research` output note exists in the vault, covers the candidates named in R9, and is linked from the phase-2 completion report.

## User Testing

1. **Read the ADR.** Does the decision feel defensible given the alternatives the spike considered? Do the Consequences read honestly, or does it undersell the hard parts?
2. **Run the prototype.** Follow the prototype's `README.md` against a real Obsidian 1.12.7 vault. Observe the claimed demos. Try to break them — open a note, split it, then open the terminal container. Does the layout behave as the ADR predicts?
3. **Verify feature-detect in the prototype.** Open Obsidian DevTools, console-eval the feature-detect predicate the ADR names. Is the result what the prototype's code assumes?
4. **Confirm graceful-degrade reasoning.** With the prototype running, mentally (or by monkey-patching in DevTools) remove the primary API surface. Does the ADR's named fallback behavior kick in, or does it throw? If it throws, the fallback isn't actually a fallback.
5. **Sanity-check the FI-012 demo** (if D3 adopted (c)). Before opening the dock, split the main editor horizontally so two note columns sit side-by-side. Open the dock. Columns should stay side-by-side; terminal docks below. If they flatten into rows, the unified-fix framing failed and the ADR should reflect that.
6. **D8 isolation by hand.** With the terminal container open and focused: use Cmd-O (quick-switcher) to open a note, then Cmd-click a link, then use a "split" modifier open. In all three cases the note must appear outside the terminal container — never as a tab inside it, never replacing the terminal. Then drag a note from the file explorer onto the terminal container; it must not land inside. If any of these regress, the ADR must say so and adopt a lower D2 rank.
7. **Read the research note.** Does it surface prior-art patterns the ADR cites — or doesn't cite — convincingly? Push back if the research covers candidates the ADR ignored without explanation.

## Boundaries

- **Out:** Any Phase 3 implementation work. Production `src/` files stay untouched (see AC10 exception).
- **Out:** FI-014 visual polish — final chrome styling, status bar design, theming. Phase 3's concern once the structural path is locked.
- **Out:** Testing infrastructure changes for the prototype. The prototype is run manually against a local Obsidian; no new e2e harness, no new unit tests. Phase 3 writes the real test coverage.
- **Out:** Upgrading the pinned Obsidian test binary. Spike anchors on 1.12.7. If 1.12.7 can't support any D2 fallback, the spike outcome is "defer" and the ADR says so.
- **Out:** Generalising the feature-detect pattern into a shared helper. Stay consistent with `bottom-dock.ts`'s inline approach; any abstraction is a separate refactor task.
- **Out:** FI-010 (picker headers — done in Phase 1), FI-015 (settings), FI-016 (theming), FI-005 (persistence), FI-011 (cross-platform). Each has or will have its own meta-plan.
- **Out:** Refactoring `src/dock/bottom-dock.ts` to accommodate the future Phase 3 wrapper. That refactor happens in Phase 3 with the benefit of this ADR's decision; attempting it in Phase 2 pre-commits to an integration shape before the spike concludes.

## Sources

- **Meta-plan:** [meta-plan.md](./meta-plan.md) lines 67–82 (Phase 2 entry), lines 28–33 (shared constraints), lines 86–107 (Phase 3 — for downstream context on what the ADR must enable)
- **FI-012 backlog entry:** `specs/anvil/future-ideas-backlog.md` lines 16–29. Note the 2026-04-16 proof-of-concept observation: Obsidian's own `workspace:split-vertical` command creates a nested `WorkspaceSplit` wrapper automatically — that's the hint for where `createSplit` or equivalent lives.
- **FI-014 backlog entry:** `specs/anvil/future-ideas-backlog.md` lines 83+. Enumerates the chrome concerns the ADR must answer.
- **Canonical feature-detect pattern:** `src/dock/bottom-dock.ts:47–63` (`setSplitDirection`) and lines 44–45 (`hasCreateLeafInParent`). The shape R4 points at.
- **Dock integration point:** `src/main.ts:159–170` — how `workspace.rootSplit` is acquired and handed to the dock factory. Phase 3 will plumb the wrapper into the same seam.
- **ADR template:** `docs/adr/_template.md`
- **ADR style reference:** `docs/adr/0003-pty-backend.md` (substantive, honest Consequences section); `docs/adr/0004-keyboard-handling-asymmetric-cmd-ctrl.md` (similar "design question with ranked options" shape)
- **ADR filename convention:** `docs/adr/README.md` — four-digit zero-padded, never renumber
- **Testing approach:** `specs/anvil/testing-approach.md` — "real Obsidian is the truth" principle applies even to a spike prototype
- **Pinned test binary version:** see `package.json` + wdio config for the exact Obsidian version locked in (expected 1.12.7 per meta-plan)
- **Prior art to skim (external):** Obsidian's own `workspace:split-vertical` command (observe in DevTools — what does the workspace tree look like before vs. after?); any community plugin that already wraps a view in a native tab container (search Obsidian plugin repos for `WorkspaceTabs` usage)
- **Durable user preferences applicable to this spike:**
  - `feedback_planning_outcomes.md` — user-named outcomes are requirements; "terminal gets native chrome + multi-terminal as tabs" is a requirement, not a design question for the spike to open back up
