# Anvil: Obsidian Terminal

Custom Obsidian plugin that embeds a real system terminal — VS Code-style shell picker, tmux session attach, multiple instances, bottom-dock placement. Built primarily for running Claude Code and other agent CLIs next to your notes. Repo is `anvil-obsidian-terminal`.

## Entry Points

- **Meta-plan:** `specs/anvil/terminal-mvp/meta-plan.md`
- **Testing approach:** `specs/anvil/testing-approach.md` — read before writing tests in any phase
Background research and task tracking live in the author's private Obsidian vault
and are not part of this repo. Everything needed to work on the plugin is in
`specs/` and `docs/`.

## Key Decisions

- **macOS arm64 only** for now. Cross-platform deferred.
- **PTY backend:** TBD — decision locked during Phase 2 spike. Candidates: Python pty helper, Rust binary + WebSocket, node-pty with prebuilt binaries.
- **Manual install only** initially. No community plugin store submission.
- **E2E harness pinning:** `wdio-obsidian-service` and the Obsidian test binary are pinned to exact versions for reproducibility. Upgrades come in as Dependabot/Renovate PRs, not silent drift.

## Dependency Maintenance

The e2e harness is solo-maintained community tooling (`wdio-obsidian-service`) plus a downloaded Obsidian binary. Both are pinned — which means they will go stale if ignored.

**Check at the start of every phase, and at minimum once a month:**
- Open Dependabot/Renovate PRs for `wdio-obsidian-service` and review them — read the changelog, merge or defer deliberately.
- Check the pinned Obsidian test binary version against current Obsidian stable. Aim to stay within ~1 minor version of stable, lagging slightly is fine (and often more realistic for what users run).
- If either has been stale for more than ~6 weeks, treat that as a small task, not something to "get to later."

If Claude is starting a new phase or session in this repo, surface the state of these upgrades as part of the kickoff.

## Architecture (3 pieces)

1. **xterm.js** — renders the terminal UI in an Obsidian ItemView
2. **PTY backend** — creates real pseudoterminals, spawns shells
3. **Plugin glue** — wires them together, provides profile picker, manages instances

## Dev Setup

```bash
# Install dependencies
npm install

# Build
npm run build

# Dev: symlink into Obsidian plugins
ln -s $(pwd) ~/.obsidian/plugins/anvil-obsidian-terminal

# Or copy build output
cp main.js manifest.json styles.css ~/.obsidian/plugins/anvil-obsidian-terminal/
```

Note: The symlink/copy path depends on which vault you're testing with. Adjust accordingly.

## Documentation

See `docs/DOCUMENTATION_STANDARDS.md` — run `/document` to execute.
