# Phase 2 Part 2: Automated R8 Verification — Spec

## Objective

Convert Phase 2 Part 1's manual R8 probes into automated e2e tests that run against the Part 1 prototype plugin using the existing `wdio-obsidian-service` harness. Each probe becomes a hard pass/fail assertion in mocha. ADR 0006 (`docs/adr/0006-workspace-container.md`) is currently `Proposed`; Part 2 flips it to `Accepted` (all R8a–d pass) or `Rejected` (any of R8a–d fails un-mitigably).

Part 2 exists because Part 1 committed to Rank 3 on research priors, not evidence. This spec closes that gap with a real red/green cycle: write the probe tests, watch R8 go RED against a deliberately-weakened prototype, confirm GREEN against the as-shipped prototype, then lock the ADR's verdict in.

## Decisions

All decisions are resolved before execution. Listed so the executing agent treats them as constraints, not open questions.

### D1. E2E spec location — in the prototype folder [RESOLVED]

`specs/anvil/pane-chrome-and-picker/phase-2-prototype/r8.e2e.ts`. Not `tests/e2e/`. The spec is coupled to the prototype plugin; it ships and is deleted with the prototype. Phase 3 does not inherit this file — Phase 3 inherits the ADR and any surviving e2e coverage lands in `tests/e2e/tab-isolation.e2e.ts` by Phase 3's own hand.

### D2. Harness scoping — dedicated wdio config + npm script [RESOLVED]

A new `wdio.proto.conf.mts` at the repo root loads BOTH the main plugin (so `pty-server` is present in the test vault and the prototype's relative-path binary resolution works) and the prototype plugin. Its `specs` glob matches only `specs/anvil/pane-chrome-and-picker/phase-2-prototype/*.e2e.ts`. A new `npm run test:e2e:proto` script invokes `wdio run ./wdio.proto.conf.mts`. The default `test:e2e` script is **not** modified.

Why: the prototype is a second plugin with its own manifest; the default test suite must not be polluted with it, and no tests in `tests/e2e/` should depend on its presence.

### D3. Prototype build is a pre-condition, not part of the runner [RESOLVED]

`npm run test:e2e:proto` assumes `specs/anvil/pane-chrome-and-picker/phase-2-prototype/main.js` has been built (`cd` into the folder, `node build.mjs`). The `before` hook in `wdio.proto.conf.mts` asserts that file exists and fails fast with a "build the prototype first" error if missing. This mirrors how the main plugin's `pty-server` binary is required to exist at `bin/pty-server` before `npm run test:e2e` runs (see `wdio.conf.mts:51–53`).

Why not bake the build in: the prototype's build is a one-off artifact; layering it into the test runner would couple an ephemeral tool to the test flow and invite drift. Build-first is the same ergonomic as the main plugin.

### D4. R8e semantics — regression-pin, not aspirational mitigation [RESOLVED]

R8e's test asserts the **documented residual** from ADR 0006: calling `leaf.setViewState({type:"markdown", state:{...}})` against the container leaf DOES replace the view. The assertion is `leaf.getViewState().type === "markdown"` post-call — i.e. the clobber happened as expected. This is a regression-pin on the known-unmitigated behavior.

This relaxes Part 1's hard-gate framing of R8e. The Phase 2 spec (Part 1) called all five probes hard gates; the prior-art research subsequently established that R8e is structurally unblockable within sanctioned APIs. Rank 3 is adopted because it's strictly better than the current multi-leaf model on every surface and no alternate rank is viable (per D5 of Part 1). Automating R8e as a pin means a future change (Obsidian behavior shift, an accidental mitigation, a silent regression) is caught rather than rotting.

**Alternative considered and rejected:** adding a `workspace.on("layout-change", ...)` observer to the prototype that detects a clobber and re-creates the container. Rejected for Part 2 scope because (a) it's a mitigation with its own design questions (recovery policy, PTY state is irrecoverable, potential recursion with other layout-change-listening plugins) and (b) if it turns out to be the right mitigation, Phase 3 owns that decision, not this spike.

### D5. ADR update scope — in-place edit, no new ADR [RESOLVED]

Part 2 edits `docs/adr/0006-workspace-container.md` in place: Status flips from `Proposed` to `Accepted` or `Rejected`, the Date is refreshed to the probe-run date, and the "R8 verification status" paragraph is rewritten with actual probe outcomes and a link to `r8.e2e.ts`. No new ADR number. The prior-art research note citation and the "Harder" section's R8e honesty stay intact.

### D6. No changes to `src/`, no changes to `tests/e2e/` [RESOLVED]

Part 1's AC10 (`git diff main -- src/` empty) stays. Added: `git diff main -- tests/e2e/` must also remain empty. Part 2's surface area is: `wdio.proto.conf.mts` (new), `package.json` (one new script), `specs/anvil/pane-chrome-and-picker/phase-2-prototype/r8.e2e.ts` (new), and `docs/adr/0006-workspace-container.md` (Status + verification paragraph). Everything else is off-limits.

## Requirements

R1. **A dedicated wdio config `wdio.proto.conf.mts`** at the repo root loads both plugins (main + prototype) into the test vault, scopes specs to the prototype folder, and copies the prototype's built files into the vault's `.obsidian/plugins/anvil-prototype-container/` in its `before` hook alongside the existing pty-server copy.

R2. **A `test:e2e:proto` npm script** in `package.json` runs `wdio run ./wdio.proto.conf.mts`. The default `test`, `test:e2e`, and `test:unit` scripts are unchanged.

R3. **An e2e spec at `specs/anvil/pane-chrome-and-picker/phase-2-prototype/r8.e2e.ts`** implements five mocha `it` blocks — one per R8a, R8b, R8c, R8d, R8e. The shape mirrors `tests/e2e/tab-isolation.e2e.ts:162–255`: activate the prototype container with at least one terminal, fire the probe via `browser.executeAsync`, assert the expected outcome.

R4. **Each R8a–d probe asserts the container is preserved.** After the probe fires: (a) the prototype container leaf still exists (`getLeavesOfType("anvil-prototype-container-view")` length ≥ 1), (b) the active tab's `.xterm` element is still visible (`offsetParent !== null`), and (c) no `.markdown-source-view` or `.markdown-preview-view` is a descendant of `.anvil-proto-container`. The note must also actually open somewhere (sanity check — same as `tab-isolation.e2e.ts:112`).

R5. **R8e's probe asserts the documented residual.** Call `leaf.setViewState({type:"markdown", state:{file:<note>,mode:"source"}})` on the container leaf. Assert that after a short settle: `leaf.getViewState().type === "markdown"`. The test is PASS when the clobber happens as documented.

R6. **All five probes run to completion in one `npm run test:e2e:proto` invocation.** Exit code is zero only when all five assertions hold. Any R8a–d failure is a real regression against the prototype; any R8e assertion flip is a behavior change that merits re-reading the ADR.

R7. **ADR 0006's Status is updated in place** at the end of Part 2. `Proposed` → `Accepted` if R8a–d all pass. `Proposed` → `Rejected` if any of R8a–d fail un-mitigably, with the paragraph citing which probe and why. The e2e spec path is cited from the ADR's "R8 verification status" paragraph.

R8. **HARD GATE applies only to R8a–d.** R8e is documentation-only per D4. The ADR's Accepted status is not contingent on R8e.

R9. **No production code touched.** `git diff main -- src/` empty (Part 1 AC10). `git diff main -- tests/e2e/` empty (new constraint per D6).

R10. **Deletability as one unit.** `wdio.proto.conf.mts`, the `test:e2e:proto` script, the `r8.e2e.ts` spec, and the whole prototype folder form one removable set. Removing them must leave `npm run test`, `npm run build`, and `npm run test:e2e` unaffected.

## Acceptance Criteria

AC1. `wdio.proto.conf.mts` exists at the repo root, extends or mirrors `wdio.conf.mts`, declares both plugins in its `wdio:obsidianOptions.plugins` array, scopes `specs` to `specs/anvil/pane-chrome-and-picker/phase-2-prototype/*.e2e.ts`, and its `before` hook copies the prototype's `main.js`, `manifest.json`, `styles.css` into the test vault's `.obsidian/plugins/anvil-prototype-container/` directory.

AC2. `package.json` has a `test:e2e:proto` script that runs `wdio run ./wdio.proto.conf.mts`. The default `test`, `test:e2e`, and `test:unit` scripts compare byte-for-byte identical to their pre-Part-2 values.

AC3. `specs/anvil/pane-chrome-and-picker/phase-2-prototype/r8.e2e.ts` contains exactly five `it(...)` blocks, one per R8a, R8b, R8c, R8d, R8e. Test names include the R8 identifier so failures are triageable from the reporter alone.

AC4. Running `npm run test:e2e:proto` with the prototype NOT built errors before launching Obsidian, with a clear message naming the missing file (`specs/anvil/pane-chrome-and-picker/phase-2-prototype/main.js`).

AC5. After `cd specs/anvil/pane-chrome-and-picker/phase-2-prototype && node build.mjs`, running `npm run test:e2e:proto` from the repo root launches Obsidian, loads both plugins, runs all five probes, and exits zero. Each test emits a green result in the wdio-obsidian reporter output.

AC6. **Red/green harness check.** Temporarily flipping `view.navigation` to `true` in `container-view.ts` and rebuilding turns at least one of R8a/b/c red. Reverting restores green. This proves the tests actually exercise the mitigation rather than pass on incidental grounds. This check is performed during Part 2 execution and recorded in the eventual completion report; the committed state leaves `navigation = false`.

AC7. If all R8a–d pass, `docs/adr/0006-workspace-container.md` has `Status: Accepted`, the Date is set to the probe-run date, and the "R8 verification status" paragraph cites `specs/anvil/pane-chrome-and-picker/phase-2-prototype/r8.e2e.ts` and names each probe's outcome plainly.

AC8. If any of R8a–d fails un-mitigably, `docs/adr/0006-workspace-container.md` has `Status: Rejected`, the Date is refreshed, and the paragraph identifies which probe failed, what mitigation was tried inside Part 2's scope (none, per D4), and states FI-014 defers.

AC9. `git diff main -- src/` is empty. `git diff main -- tests/e2e/` is empty.

AC10. Removing `wdio.proto.conf.mts`, the `test:e2e:proto` line in `package.json`, `specs/anvil/pane-chrome-and-picker/phase-2-prototype/`, and the ADR's Part-2-specific paragraph additions leaves `npm run test`, `npm run build`, and `npm run test:e2e` operating identically to pre-Part-2. Verified by inspection.

## User Testing

1. **Clean run.** From a freshly-built tree: `cd specs/anvil/pane-chrome-and-picker/phase-2-prototype && node build.mjs && cd - && npm run test:e2e:proto`. Five tests, all green, in under 90 seconds (wdio timeout is 60s per test).
2. **Isolation from default suite.** `npm run test:e2e` (or `npm run test`) runs exactly the same specs it ran before Part 2, with no prototype plugin loaded. If the test count changes or a new plugin appears in the wdio log, Part 2 regressed the default flow.
3. **Red/green spot-check.** Flip `view.navigation = false` to `view.navigation = true` in `specs/anvil/pane-chrome-and-picker/phase-2-prototype/container-view.ts`. Rebuild. Rerun `npm run test:e2e:proto`. At least one of R8a/b/c should turn red — if all five still pass, the test is asserting the wrong thing and the spec needs another look. Revert the flip.
4. **Read the ADR.** Its Status matches the verdict. The verification paragraph points at the e2e spec. The Consequences section's R8e honesty is preserved.
5. **Teardown sanity.** Delete `wdio.proto.conf.mts`, the `test:e2e:proto` script, and the prototype folder (leave the ADR). Run `npm run build && npm run test`. Everything passes. This confirms R10/AC10 — the Part 2 surface is cleanly removable as the prototype expires.

## Boundaries

- **Out:** New tests in `tests/e2e/`. Permanent R8 coverage after Phase 3 ships is Phase 3's job; D1 is firm.
- **Out:** Modifying `wdio.conf.mts`, the default `test:e2e` script, or any existing `tests/e2e/*.e2e.ts` spec. Prototype tests live in their parallel config only.
- **Out:** Modifying `src/` or `tests/e2e/` (Part 1 AC10 + D6).
- **Out:** Adding an R8e mitigation to the prototype (layout-change observer, setViewState override, monkey-patching). D4 is resolved; R8e is documented residual, not engineering work.
- **Out:** Refactoring or extracting helpers from `tests/e2e/tab-isolation.e2e.ts`. If `r8.e2e.ts` needs the same helpers (`collectReport`, `assertIsolation`, `ensureTestNote`), copy-paste is acceptable — this spec is throwaway, and shared infra would entangle it with the default suite.
- **Out:** Running R8 against the current multi-leaf `TerminalView` for comparison. The research note already covered that comparison; re-litigating it burns Part 2 time.
- **Out:** Phase 2 completion report. The completion report spans both parts and is written after Part 2's execution lands.
- **Out:** Visual / chrome polish on the prototype. R8 is about isolation + state, not looks.
- **Out:** Cross-platform probe coverage. macOS arm64 only, matching the repo.

## Sources

- **Part 1 spec:** `specs/anvil/pane-chrome-and-picker/phase-2-workspace-container-spike-spec.md` — the requirements Part 2 is verifying against.
- **Part 1 prototype (the test subject):** `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` — `main.ts`, `container-view.ts`, `probes.ts`, `README.md`.
- **Part 1 ADR (the artifact Part 2 finalizes):** `docs/adr/0006-workspace-container.md`, currently `Proposed`.
- **Harness pattern to mirror:** `tests/e2e/tab-isolation.e2e.ts:162–255` — the three `openLinkText` modes and the synthetic drop, plus the `assertIsolation` / `collectReport` helpers. Copying their shape into `r8.e2e.ts` is fair game; do not import from them (per boundaries).
- **Existing wdio config (the precedent):** `wdio.conf.mts` — especially the `before` hook at lines 38–57, which establishes how to copy plugin artifacts into the test vault post-launch.
- **Prior-art research (the authority for D4):** vault note `Programming/Tabbed Containers with Content Isolation - Prior Art.md` — "setPinned does not block explicit `setViewState`" finding.
- **Probe payload reference:** `specs/anvil/pane-chrome-and-picker/phase-2-prototype/probes.ts` — the DevTools-pasteable versions Part 1 authored. `r8.e2e.ts` is the wdio-shaped version of the same logic.

## Next command

`/phase-exec Phase 2 Part 2`
