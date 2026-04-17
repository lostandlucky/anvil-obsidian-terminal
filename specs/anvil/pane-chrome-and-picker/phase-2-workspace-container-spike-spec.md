# Phase 2: Workspace Container Design Spike — Spec (v2, Rank-3-only)

## Objective

Spike a single architectural option — one `ItemView` leaf with N xterm instances multiplexed inside its DOM, switched via a VS Code-style vertical side-tab selector — and commit the outcome to ADR `docs/adr/0006-workspace-container.md`. If the R8 tab-isolation probes pass against the prototype, the ADR accepts Rank 3 as the Phase 3 target. If any probe regresses un-mitigably, the ADR records rejection and defers FI-014.

The prior-art research note at `Programming/Tabbed Containers with Content Isolation - Prior Art.md` (vault) is the authority for why this spike investigates one option rather than a ranked ladder.

## Decisions

All decisions are resolved before execution. Listed so the executing agent treats them as constraints, not open questions.

### D1. Prototype fidelity **[RESOLVED → real PTY]**

Each prototype tab runs a live shell. xterm state (cursor, scrollback, running foreground process) must survive side-tab switches without loss. Simulated / echo-loop xterms do not catch the "tab switch disposes xterm state" regression this spike needs to rule out.

### D2. Picker integration scope **[RESOLVED → container only]**

The prototype covers multi-terminal + side-tab switching + R8 probes. FI-012 (picker → new-terminal flow) is Phase 3 scope; the ADR should name the FI-012 relationship explicitly but the prototype does not need to wire it up.

### D3. ADR number **[RESOLVED → 0006]**

`docs/adr/0006-workspace-container.md`. `0005` is taken by picker-section-labels.

### D4. Prototype location **[RESOLVED → throwaway subfolder]**

`specs/anvil/pane-chrome-and-picker/phase-2-prototype/`. Outside `src/`, outside the esbuild input, not imported by production code.

### D5. Fallback if Rank 3 fails an R8 probe **[RESOLVED → defer FI-014]**

The prior-art research rejected Ranks 1, 2, and 4 (the old ranked ladder) as structurally unable to close Obsidian's multi-leaf attack surfaces. There is no alternate rank to fall back to. If Rank 3 fails any R8 probe un-mitigably, the ADR records rejection with rationale and FI-014 goes back to the backlog for a future meta-plan.

## Requirements

R1. **A prototype runs against the pinned Obsidian test binary** and demonstrates the chosen approach live — two or more terminals inside a single `ItemView` leaf, switched by a vertical side-tab selector, each running a live shell.

R2. **An ADR exists at `docs/adr/0006-workspace-container.md`** with `Status: Accepted` (if Rank 3 passes) or `Status: Rejected` (if it fails R8 un-mitigably). Follows `docs/adr/_template.md`. Records the decision, the reasoning, and the consequences honestly.

R3. **The ADR names concrete API surfaces.** `ItemView` subclass + view type string. The leaf-level protections the approach depends on (`view.navigation`, `setPinned`, and any other lever the prototype uses). Each is named at code-level — exact method name, not a vague "use Obsidian's view API."

R4. **Any undocumented Obsidian API surface the ADR depends on MUST follow the feature-detect + graceful-degrade pattern at `src/dock/bottom-dock.ts:44–63`.** The ADR names the feature-detect predicate for each undocumented surface (e.g., `typeof leaf.setPinned === "function"`).

R5. **The prototype is clearly throwaway.** Lives at `specs/anvil/pane-chrome-and-picker/phase-2-prototype/`. Not in esbuild. No production imports. Directory contains a `README.md` describing how to load and run it against a local Obsidian vault.

R6. **Spike discipline: judgment-based stopping.** The spike stops when either (a) R8 probes + success demos pass and the ADR is accepted, or (b) any R8 probe regresses in a way the prototype cannot mitigate within the spike's scope and the ADR is rejected. No clock; pause and surface when any R8 probe fails before continuing.

R7. **A Phase 2 completion report** is written at `specs/anvil/pane-chrome-and-picker/phase-2-completion-report.md`. Summarizes the outcome (accept/reject), the API surfaces Phase 3 will use (if accept) or the defer rationale (if reject), and the Phase 3 integration scope against `src/main.ts:159–170`.

R8. **HARD GATE — tab isolation.** The prototype must pass all four R8 probes. If any probe regresses un-mitigably, the ADR is Rejected and FI-014 defers.

- **R8a.** `workspace.openLinkText(base, "", false)` (default mode) while the terminal container is focused — the note lands outside the terminal container, the container's xterm stays visible.
- **R8b.** `workspace.openLinkText(base, "", "tab")` (Cmd-click equivalent) — same outcome as R8a.
- **R8c.** `workspace.openLinkText(base, "", "split")` (split modifier) — same outcome as R8a.
- **R8d.** Synthetic HTML5 drag-drop of a note onto the terminal container — note does not land inside the container; terminal xterm stays visible.
- **R8e** *(new, not in v1)*. A simulated third-party call to `leaf.setViewState({type: "markdown", state: {...}})` against the terminal leaf — does not silently clobber the container. Mitigation via `setPinned(true)` and/or `view.navigation = false` is acceptable; the ADR names which mitigation is relied on.

Probe shape mirrors `tests/e2e/tab-isolation.e2e.ts:162–255`. R8e is new — the old spec did not name it, but the prior-art research flagged it as a real attack surface (third-party plugins like Hover Editor, Mononote can do this).

## Acceptance Criteria

AC1. **ADR exists with a definite status.** `docs/adr/0006-workspace-container.md` has `Status: Accepted` or `Status: Rejected`. ISO date in header. Context / Decision / Consequences sections non-empty per `docs/adr/_template.md`.

AC2. **ADR names the concrete API surfaces Phase 3 will use.** A reader can identify the exact runtime object properties or method names Phase 3 is expected to call. No vague "use the ItemView API."

AC3. **ADR names the feature-detect predicates in code-level terms.** Each undocumented API surface has a runtime check (`typeof X === "function"` or equivalent).

AC4. **ADR names the FI-012 relationship.** One of: Subsumed / Independent / Deferred, with one sentence of rationale.

AC5. **Prototype runs.** Following the prototype's `README.md`, a reader can launch the pinned Obsidian binary with the prototype loaded and observe two or more terminals inside a single `ItemView`, switchable via the side-tab selector.

AC6. **Prototype preserves xterm state across tab switches.** Each tab runs a live shell (D1). Switching away from a tab and back preserves the shell's state (cursor position, scrollback, running foreground process). Verifiable over at least 3 switches.

AC7. **Prototype is outside `src/`.** `ls src/ | grep -i prototype` returns nothing. `grep -rn "phase-2-prototype" src/` returns nothing.

AC8. **All R8 probes pass against the prototype.** R8a–R8e all produce the expected outcome. If any probe fails, AC1's status is `Rejected` and the ADR explains which probe failed and why no mitigation worked.

AC9. **Completion report exists and summarizes the outcome.** Names the ADR status, the API surfaces adopted (or defer rationale), and the Phase 3 integration scope (how `src/main.ts:159–170` will change).

AC10. **No production `src/` files were changed.** `git diff main -- src/` is empty. Exception: if Phase 2 uncovers a blocking bug in `src/dock/bottom-dock.ts`, flag it and decide with the user whether to patch in-phase or log a new FI.

## User Testing

1. **Read the ADR.** Is the decision defensible? Do the Consequences undersell the hard parts? Does "why only Rank 3" feel convincing, with the research note cited?
2. **Install the prototype.** Follow the prototype `README.md` against a real vault with the pinned Obsidian version. Open two terminals. Use the side-tab selector to switch between them. Run `ls` in one, switch away, switch back — same shell, same state.
3. **R8 by hand (picker modes).** With the terminal container focused: Cmd-O to quick-switcher a note. Cmd-click a wikilink. Use a split-modifier open. In all three cases the note lands outside the terminal container; the terminal stays visible.
4. **R8 by hand (drag-drop).** Drag a note from the file explorer onto the terminal tab header. Drop on the terminal content area. Neither drop puts the note inside the terminal.
5. **R8e by hand.** With another plugin installed that aggressively calls `setViewState` on leaves (e.g., Hover Editor, Mononote), confirm the terminal leaf is not silently clobbered.
6. **Read the completion report.** Is the Phase 3 scope clear enough that the next session can pick up without re-deriving anything?

## Boundaries

- **Out:** Any Phase 3 implementation. Rewriting the plugin to the accepted approach happens after this spike, with the ADR in hand.
- **Out:** Re-exploring Ranks 1, 2, or 4 from the old spec. The prior-art research rejected them; the ADR cites the research note as the reason this spike covers one option.
- **Out:** FI-012 (picker → new-terminal wiring). Picker integration is Phase 3 scope; the ADR names the relationship but the prototype does not wire it.
- **Out:** PTY backend decisions. That's its own spike under FI-013. This spike uses whatever PTY backend is easiest to embed in a throwaway prototype — not a commitment.
- **Out:** New e2e tests in `tests/e2e/`. The prototype's R8 verification runs by hand or via DevTools console. If R8 probes need permanent coverage after Phase 3 ships, `tests/e2e/tab-isolation.e2e.ts` already exists and Phase 3 can extend it.
- **Out:** Changes to the meta-plan or the FI backlog. Those updates follow the spike's outcome in a separate change, not this spec.
- **Out:** Any visual/theming polish for FI-014. The prototype needs to prove the structure works; pretty chrome is Phase 3.
- **Out:** FI-010 (picker headers — shipped Phase 1), FI-015 (settings), FI-016 (theming), FI-005 (persistence), FI-011 (cross-platform), FI-013 (PTY backend).
- **Out:** Refactoring `src/dock/bottom-dock.ts` to accommodate the future Phase 3 wrapper. That refactor happens in Phase 3.

## Sources

- **Current view pattern:** `src/view/TerminalView.ts` — `ItemView` subclass, view type `"obsidian-terminal-view"` (line 8), constructor at line 22. Rank 3's prototype mirrors this shape but multiplexes inside.
- **Canonical feature-detect pattern:** `src/dock/bottom-dock.ts:44–63` — the shape R4 points at.
- **View registration:** `src/main.ts:44–47` — `registerView(TERMINAL_VIEW_TYPE, ...)`.
- **Phase 3 integration seam:** `src/main.ts:159–170` — `getDock()` constructor. Phase 3 will plumb the Rank 3 container into this seam.
- **xterm mount pattern:** `src/terminal/xterm-host.ts:39` — `terminal.open(container)`. Prototype will have N xterm instances, each mounted into a DOM node the `ItemView` manages.
- **R8 probe shape:** `tests/e2e/tab-isolation.e2e.ts:162–255` — three `openLinkText` modes + synthetic drop. R8e (third-party `setViewState`) is new; no existing test — verify by hand or inline in the prototype.
- **ADR template:** `docs/adr/_template.md`.
- **ADR voice reference:** `docs/adr/0005-picker-section-labels-as-decorated-siblings.md` — recent, in the same repo, same shape of "design question with ranked options resolved."
- **ADR filename convention:** `docs/adr/README.md` — four-digit zero-padded, never renumber.
- **Testing approach:** `specs/anvil/testing-approach.md` — "real Obsidian is the truth" applies to prototypes too.
- **Prior-art research (THE AUTHORITY for why this spike covers one option):** vault note `Programming/Tabbed Containers with Content Isolation - Prior Art.md`. Covers VS Code's integrated terminal panel (the model Rank 3 mirrors), Obsidian multi-instance plugins (Kanban, Excalidraw, Termy — none solve the problem), Obsidian forum/API landscape (confirmed no typed-tab-group API), and terminal emulators as prior art for tabbed containers. Linked from the Phase 2 completion report.
- **Durable user preferences applicable to this spike:**
  - `feedback_planning_outcomes.md` — user-named outcomes are requirements. "Terminal gets its own chrome + multi-terminal as tabs in one container" is a requirement; not re-opened.

## Next command

`/phase-exec Phase 2`
