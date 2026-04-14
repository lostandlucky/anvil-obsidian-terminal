# Documentation Standards

This file defines how documentation works in the obsidian-terminal-plugin repo: what kinds of docs exist, where they live, and how they get written. It's the rules of the road. The execution half is `/document` — run that when you want to generate, update, or audit docs against these standards. Edit this file directly whenever the rules need to change; it's prose, meant to be human-maintained.

Audience for the docs themselves is **future-self plus the occasional early external installer** — enough to get someone who's never seen this plugin to a working install and a working dev loop, without committing to a full public-release doc set. `Explanation`-style docs (architecture essays, deep dives into why things are the way they are) are deliberately deferred until there's a real audience asking for them. The absence of an Explanation section below is intentional, not an oversight.

## Diátaxis Types Used

Three quadrants are in scope:

- **Reference.** Hand-written prose under `docs/reference/`. One file per logical unit (commands, settings, the `TerminalView`, the PTY backend once it exists). Third-person, factual, no procedural steps.
- **How-To.** Task-oriented guides under `docs/how-to/`. Titles are problems, not features: "How to run the e2e suite," not "The e2e suite." Second-person ("you"). Seed topics: dev setup, manual install, running tests.
- **ADR.** Architecture decision records under `docs/adr/`. MADR-minimal format. See the ADRs section below.

**Tutorial** is collapsed into the README (see `## README` below). The README walks a first-time installer from zero to a running terminal pane; that's the tutorial. There is no separate `docs/tutorial/` folder.

**Explanation** is deferred as a folder. The conceptual content that would normally live there has been *reassigned* to specific named slots so it doesn't fall through cracks:

- **Project pitch and target audience** → the `## What this is` section of the root `README.md`.
- **Architecture map** (what the moving pieces are and how they connect) → `docs/reference/architecture.md`. Stays factual and structural; no rationale, no narrative.
- **Rationale and tradeoffs behind a decision** → an ADR under `docs/adr/`.
- **Conceptual context for a specific task** → the intro paragraph of the relevant how-to.

If you find yourself wanting to write a freeform Explanation doc, stop and figure out which of the four slots above it belongs in. Architectural reasoning is usually an ADR. The "what is this thing and what shape does it have" question splits between the README pitch and the architecture reference.

## README

The root `README.md` does several jobs at once. It is not a Diátaxis quadrant — it's a multipurpose contract. Required sections, in order:

- **Title and tagline** — one or two lines under the title. What the product is in plain language. Not the manifest blurb.
- **`## What this is`** — vision, current state, who it's for. The "what the fuck is this" answer. Includes a forward link to `docs/reference/architecture.md` for the shape of the system.
- **Platform callout** — macOS arm64 only. Explicit because the code itself doesn't enforce it.
- **`## What you need`** — prerequisites for a first-time installer.
- **`## From zero to a running terminal pane`** — the tutorial role. A complete first run, beginning to end, no branching. Don't grow this beyond a true beginner's first pass; deeper install variants live in `docs/how-to/`.
- **`## Where to go next`** — link-out hub to how-tos, ADRs, and this standards file.
- **`## Known limits`** — what doesn't work yet, with links to the relevant ADRs.

Keep the README tight. If a section bloats past an obvious skim, move detail into a how-to or reference doc and link out from here.

## Style and Tone

Match the voice of `CLAUDE.md`, `specs/terminal-plugin/meta-plan.md`, and `specs/terminal-plugin/testing-approach.md`. That voice is:

- Terse, direct, pragmatic. No sales language. No "seamlessly," no "effortlessly," no "robust."
- Explain *why*, not just *what*. If a decision has a reason, say the reason.
- First-person singular ("I") or second-person ("you") where natural. Avoid the editorial "we" unless it's genuinely plural.
- Reference docs: third-person, factual, present tense.
- How-tos: second-person imperative. "Run `npm run build`," not "The user should run `npm run build`."
- Don't invent content to fill a section. If there's nothing to say under a heading, delete the heading.

Code blocks: prefer real, copy-pasteable commands. Fenced with the language (```bash, ```typescript, ```json).

## Reference Docs

Location: `docs/reference/`. One file per logical unit. Candidate units as of this writing:

- Plugin commands (what shows up in the Obsidian command palette)
- Plugin settings (the settings tab fields and what they do)
- `TerminalView` (the Obsidian `ItemView` subclass that hosts the terminal)
- The xterm.js host wrapper (`src/terminal/xterm-host.ts`)
- The PTY backend, once Phase 2 lands

Reference is **hand-written**, not generated. No tsdoc/typedoc pipeline for now. The public surface is small enough that a docgen tool is overkill, and the cost of a wrong-but-confident generated doc is higher than the cost of writing prose. Revisit if the surface grows past ~10 units or if the plugin ever ships to the community store.

Each reference file should tell the reader: what the thing is, what it exposes, what its inputs/outputs are, and what it does not do. No installation steps, no tutorials, no "why." Link out to a how-to or ADR for those.

**Architecture overviews live here too.** `docs/reference/architecture.md` is a factual map of the system's moving pieces — what each part is, how they connect, what exists today vs. what's deferred. It stays Reference-shaped: third-person, no rationale, no narrative. Rationale belongs in an ADR. This is how the project handles the architecture-overview job that would normally live in an Explanation doc; see the Diátaxis Types Used section above for the full reassignment of deferred-Explanation content.

## How-Tos

Location: `docs/how-to/`. Problem-oriented titles. Seed the folder with:

- `dev-setup.md` — clone, install, symlink into an Obsidian vault, run the dev build.
- `manual-install.md` — build, copy `main.js`/`manifest.json`/`styles.css` into a vault's plugin folder, enable in Obsidian.
- `run-tests.md` — `npm run test:unit` and `npm run test:e2e`, including the wdio-obsidian-service caveats.

A good how-to has a one-sentence problem statement at the top ("You want to X"), then ordered steps, then a "troubleshooting" section only if there are known gotchas. No backstory, no architecture asides. If you need to explain why a step exists, link to an ADR.

## ADRs

Location: `docs/adr/`. Format: MADR-minimal (`Status`, `Context`, `Decision`, `Consequences`). Filenames: `NNNN-slug.md`, zero-padded four-digit sequence. Use `_template.md` as the starting point.

Write an ADR when:

- The decision is hard to reverse (dependency choice, data format, distribution method).
- The decision affects architecture (where state lives, how processes talk to each other).
- Future-you will ask "why did we do it this way" and deserves a real answer.

Don't write an ADR for every small choice. If the answer fits in a code comment, leave it there.

Seeded slots:

- `0001-macos-arm64-only.md` — retrospective, captures the scope decision from `CLAUDE.md`.
- `0002-manual-install-only.md` — retrospective, captures the distribution decision.
- `0003-pty-backend.md` — **reserved**. Write when Phase 2 locks the PTY backend choice. The three candidates (Python pty helper, Rust binary + WebSocket, node-pty with prebuilts) and the tradeoffs are already documented in the meta-plan; the ADR should record which was picked, why, and what gets harder if you need to change it later.

Retrospective ADRs are fine. Mark them `Status: Accepted (retrospective)` so it's clear the decision predates the record.

## Staleness

Detection is **diff-based**. When `/document` runs, it compares `git log` since the last commit that touched `docs/` against the working tree and flags any source changes that plausibly affect existing docs. The mapping is heuristic (file path patterns, symbol names mentioned in reference docs), so `/document` asks before editing — it never rewrites docs silently.

If you rename a public symbol or move a file that's referenced in `docs/reference/`, expect `/document` to flag it on the next run. If you want to force a full audit, tell `/document` to ignore the diff and walk the whole tree.

## Visual Capture

Screenshots of the Obsidian plugin UI are **manual**. The wdio-obsidian-service harness can technically drive Obsidian end-to-end, but screenshotting through it is fragile (timing, theme, window size, Obsidian version drift) and not worth automating for a solo project. Take screenshots by hand, crop them, and commit them under `docs/assets/` when you actually have one to add. Don't create `docs/assets/` preemptively.

There is no Playwright or shot-scraper pipeline. The project uses wdio for e2e testing, not Playwright, and e2e is not a documentation-capture path.

## Subagent Handoff

When `/document` delegates a write to a subagent — for example, generating a reference doc for a specific source file — the handoff must include:

- **The exact file path** to document (e.g. `src/view/TerminalView.ts`), not a description.
- **The target doc path** (`docs/reference/terminal-view.md`).
- **The heading structure expected** for that doc type (Reference: What it is / What it exposes / Inputs & Outputs / What it does not do).
- **The voice rules from this file** — specifically, that reference docs are third-person factual, no tutorials, no invented rationale. Subagents will drift into marketing prose if you don't pin them.
- **A pointer to this standards file** so the subagent can check its own work against the rules.

Don't let subagents decide which file to document, which section to write, or whether a given decision deserves an ADR. Those are judgment calls for the human or for `/document` itself.

## Project Notes

- **macOS arm64 only.** Don't write docs that imply cross-platform support. When describing install steps, shell commands, or paths, assume macOS. If a Linux/Windows user shows up, that's a scope change, not a documentation fix.
- **PTY backend is pending.** Phase 2 will lock the choice. Until it does, don't write reference docs for the backend, and don't write an ADR for it. The slot at `docs/adr/0003-pty-backend.md` is reserved.
- **E2E harness is pinned and audited.** `wdio-obsidian-service` and the Obsidian test binary are pinned to exact versions. `CLAUDE.md` mandates checking their upgrade state at phase kickoffs. If a doc references the harness version, it can go stale — prefer linking to `package.json` or the `wdio.conf.mts` file rather than hardcoding a version string.
- **Planning artifacts live in `specs/`, not `docs/`.** `specs/terminal-plugin/` holds the meta-plan, phase specs, and completion reports. `/document` should not touch `specs/`. If something from a completion report belongs in the permanent record, lift it into a reference doc or an ADR deliberately — don't auto-sync.
