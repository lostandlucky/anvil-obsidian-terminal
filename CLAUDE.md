# Obsidian Terminal Plugin

Custom Obsidian plugin that embeds a real system terminal — VS Code-style shell picker, tmux session attach, multiple instances.

## Entry Points

- **Meta-plan:** `specs/terminal-plugin/meta-plan.md`
- **Technical research:** Vault → `Programming/Obsidian Terminal Plugin - Technical Design Research.md`
- **Task note:** Vault → `TaskNotes/Tasks/Obsidian Terminal Plugin.md`

## Key Decisions

- **macOS arm64 only** for now. Cross-platform deferred.
- **PTY backend:** TBD — decision locked during Phase 2 spike. Candidates: Python pty helper, Rust binary + WebSocket, node-pty with prebuilt binaries.
- **Manual install only** initially. No community plugin store submission.

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
ln -s $(pwd) ~/.obsidian/plugins/obsidian-terminal-plugin

# Or copy build output
cp main.js manifest.json styles.css ~/.obsidian/plugins/obsidian-terminal-plugin/
```

Note: The symlink/copy path depends on which vault you're testing with. Adjust accordingly.
