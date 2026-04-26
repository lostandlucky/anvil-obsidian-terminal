# Meta-Plan: Terminal Core Extraction

## Context

Steve wants to eventually publish a standalone terminal app — likely React on top of Tauri or Electron — alongside the existing Obsidian plugin. Rather than splitting into two repos now, this work converts the project into a monorepo and extracts the framework-agnostic terminal pieces into a `terminal-core` package, which the Obsidian plugin and a future second frontend both consume. Splitting repos can happen later; the value of doing this now is forcing the API to be honestly portable while the design is still moving, and giving Steve a parallel surface to dogfood changes against.

The original Phase 2/3 architecture (see `../terminal-mvp/meta-plan.md`) already left `src/terminal/xterm-host.ts` and the entire `src/pty/` directory framework-agnostic in practice. The Obsidian-coupled code is concentrated in `TerminalContainerView.ts`, `main.ts`, `dock/`, `settings/`, and the Obsidian-modal half of `picker/`. The seams exist; this body of work makes them load-bearing.

**Project location:** `~/dev/anvil-obsidian-terminal/`
**Specs location:** `~/dev/anvil-obsidian-terminal/specs/anvil/terminal-core-extraction/`

## Scope

**IN:** Convert the repo to a monorepo (workspaces), extract a framework-neutral `terminal-core` package, refactor the Obsidian plugin to consume it as a workspace dependency, stand up a minimal React-on-Tauri-or-Electron second frontend in the same monorepo to validate the core API isn't accidentally Obsidian-shaped.

**OUT:**
- Publishing `terminal-core` to npm — deferred until both consumers have exercised the API.
- Splitting into separate repos — deliberately deferred per user; monorepo is the chosen workflow.
- A polished second frontend — it's a dogfood, not a product. UI polish, distribution, and feature parity with the Obsidian plugin are not in scope.
- Browser-target support for terminal-core — both consumers are desktop; revisit later if a hosted demo is wanted.
- Changes to `pty-server` — already a standalone Rust binary, no work needed.
- New terminal features — focus is restructure, not capability.

## Shared Constraints

- **Workspaces tooling.** Project currently uses `npm`. npm workspaces is the path of least resistance and keeps the existing Dependabot/lockfile setup. Decision should be locked in Phase 1; alternatives (pnpm, bun) only worth considering if a concrete benefit surfaces.
- **`terminal-core` is framework-neutral.** Public API exposes DOM-mounting primitives (mount onto an `HTMLElement`, return handles for write/resize/dispose). No React, Vue, or Obsidian-specific types in the surface. React wrapping happens inside the consuming frontend, not as a `@anvil/terminal-react` package — adding a React adapter eagerly would bias core toward one paradigm before either consumer needs it.
- **Frontend-injected concerns.** Today the plugin resolves the pty-server binary path via Obsidian's vault adapter and infers cwd from the same. terminal-core must not bake either assumption — both come in as constructor args or factory params.
- **Test ownership.** Unit tests stay colocated with source in whichever package owns the code. The `wdio` Obsidian e2e suite stays with the plugin package; it tests Obsidian integration, not core. terminal-core needs its own unit-test suite for the pieces moved into it.
- **Dependency maintenance.** Each phase still kicks off with the Dependabot/Obsidian-binary audit per the project's `CLAUDE.md`. No change to that cadence.
- **No backward-compat shims.** The plugin isn't published; all consumers of the moved code are in-tree. Refactor freely.

## Dependency Map

```
Phase 1 (monorepo restructure) → Phase 2 (extract terminal-core) → Phase 3 (second-frontend dogfood)
```

Strictly sequential. Phase 2 needs the workspaces foundation. Phase 3 needs a real `terminal-core` to consume — though it's also where API gaps get pushed back into Phase 2 territory if needed.

---

## Phase 1: Monorepo Restructure

**Goal:** Repo is reorganized into a workspaces layout with the existing Obsidian plugin as a single package. No code is extracted yet — this phase is purely structural. The plugin builds and all unit + e2e tests pass from the new package location, with no behavior changes. This is deliberately a lift-and-shift so the extraction in Phase 2 happens against a stable foundation rather than tangled with the workspaces migration.

**Dependencies:** None.

**Success criteria:**
- Workspaces tooling chosen and configured at the repo root; Dependabot still works against it.
- Existing source moved into a single plugin package without API changes.
- `npm run build`, `npm run test:unit`, `npm run test:e2e`, and `npm run typecheck` all pass from the new structure.
- The build still produces the same `main.js` / `styles.css` / `bin/pty-server` artifacts in the locations the existing manual install + e2e harness expect.
- README and CLAUDE.md updated with the new layout so a fresh checkout knows where things are.

**Risk flags:**
- esbuild config and the cargo binary copy in `esbuild.config.mjs` are tangled together — the build orchestration may need rework just to handle the path change cleanly.
- The wdio e2e harness has hardcoded paths into the build output — workspace moves could silently break them.
- `tsconfig.json` `include` paths and Vitest path resolution have to update in lockstep.

---

## Phase 2: Extract `terminal-core`

**Goal:** A `terminal-core` package exists in the monorepo with a framework-neutral public API. It owns the xterm.js host, the PTY transport client, the protocol types, and any other code that has no Obsidian dependency. The Obsidian plugin consumes it via workspace dependency and exhibits no behavior changes. The shape of the public API is the deliverable; file moves are incidental.

**Dependencies:** Phase 1 complete.

**Success criteria:**
- `terminal-core` exposes a public API that is documented and framework-neutral (no `obsidian` import, no React, no UI-framework type in the surface).
- All clearly-portable code moved (xterm host wrapper, PTY backend, protocol client, mock backend for testing).
- The decision of where the multi-tab manager and shell/tmux discovery live (core vs frontend) is made and justified in an ADR or short design note.
- Frontend-injected concerns (pty-server binary path, cwd, default shell) come in via parameters, not implicit lookups.
- terminal-core has its own unit-test suite covering the moved code; coverage doesn't regress.
- The Obsidian plugin builds and all e2e tests pass against the new arrangement.

**Risk flags:**
- The right home for the multi-tab UI (currently inside `TerminalContainerView`) is the central design call — it shapes how much chrome each frontend has to rebuild. Easy to over- or under-extract.
- Profile discovery (`shell-discovery.ts`, `tmux-discovery.ts`) is framework-neutral but UI-adjacent; "what goes in core" is a real design decision, not obvious.
- API churn risk: first abstractions are rarely the right ones. Mitigated by Phase 3 exercising the API from a second consumer.
- Build-time vs runtime types: terminal-core needs to be consumable as TS source by the plugin (via workspaces) and as compiled output by any future published consumer. Build setup must handle both.

---

## Phase 3: Second-Frontend Dogfood

**Goal:** A minimal second frontend exists in the monorepo — React on Tauri or Electron — that consumes `terminal-core` and runs a real terminal end-to-end. It exists to prove the core API isn't accidentally Obsidian-shaped, and to give Steve a parallel surface for testing terminal-core changes. It is explicitly not a product: UI polish, distribution, and feature parity with the Obsidian plugin are out of scope.

**Dependencies:** Phase 2 complete.

**Success criteria:**
- A second package exists in the monorepo that depends on `terminal-core`.
- It launches, mounts a terminal, runs a real shell via the same `pty-server` binary, and handles input / output / resize.
- Any API gaps or Obsidian-leaks discovered while wiring it up have been pushed back into terminal-core fixes, not papered over in the frontend.
- A short note documents the choice between Tauri and Electron (decision locked at spec time) and any consequences for terminal-core.
- Both packages can be developed and tested in parallel from the monorepo root.

**Risk flags:**
- Tauri vs Electron involves different build tooling and binary distribution stories — picking one at spec time matters more than picking "right."
- If the second frontend reveals fundamental gaps in terminal-core, this phase may need to push work back into Phase 2 territory rather than absorbing it locally.
- React's lifecycle (StrictMode double-mount, ref handling) exercises terminal-core's mount/dispose contract in ways the Obsidian plugin doesn't — surprises likely.
- Cross-cutting concerns the Obsidian plugin gets for free (window chrome, focus management, hotkey arbitration) all need first-pass answers in the second frontend even if rough.

---

## Verification

After each phase, both packages (where they exist) should build cleanly from the monorepo root, their respective tests should pass, and the Obsidian plugin should remain installable into a real vault and behave identically to its pre-refactor self.
