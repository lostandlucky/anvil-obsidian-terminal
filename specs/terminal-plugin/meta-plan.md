# Meta-Plan: Obsidian Terminal Plugin

## Context

Steve wants a custom Obsidian plugin that embeds a real system terminal — not because it doesn't exist, but because he doesn't trust third-party plugins with terminal access. The plugin should work like VS Code's terminal: discover available shells, let you pick one, and also attach to existing tmux sessions. The technical research is complete (see vault: `Programming/Obsidian Terminal Plugin - Technical Design Research.md`).

**Project location:** `~/dev/obsidian-terminal-plugin/`
**Specs location:** `~/dev/obsidian-terminal-plugin/specs/terminal-plugin/`

## Scope

**IN:** Obsidian plugin that opens terminal panes with real PTY-backed shells, profile picker for shell/session selection, tmux session attach, multiple concurrent instances, settings UI, macOS distribution.

**OUT:** Cross-platform support (Linux/Windows deferred), community plugin store submission (manual install only initially), custom shell implementation, pane-level tmux integration (control mode).

## Shared Constraints

- **PTY backend choice:** The biggest architectural decision. Three viable options (Python pty helper, Rust binary + WebSocket, node-pty with prebuilt binaries). Decision must be locked before Phase 2. This is a cross-phase concern — it affects build tooling, distribution, and the data path between xterm.js and the shell.
- **macOS arm64 primary target:** All phases target Steve's machine first. Other platforms are explicitly out of scope.
- **Obsidian plugin conventions:** TypeScript, esbuild, manifest.json, styles.css. Plugin runs in Electron renderer with Node.js access.

## Dependency Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4
              ↑
        PTY backend spike
        (between P1 and P2)
```

Strictly sequential. Phase 3's picker UI could start in parallel with late Phase 2, but session features need a working PTY.

---

## Phase 1: Plugin Scaffold + Terminal Rendering

**Goal:** Get an Obsidian plugin that opens a pane with xterm.js rendering in it. No real shell yet — just prove that xterm.js works inside Obsidian's view system, handles resize, and captures keystrokes without Obsidian intercepting them. This retires all the Obsidian plugin API risk before adding PTY complexity.

**Dependencies:** None.

**Success criteria:**
- Plugin loads in Obsidian, command palette action opens a terminal pane
- xterm.js renders and responds to resize (FitAddon works with Obsidian layout)
- Keystrokes go to xterm.js, not Obsidian hotkeys (Ctrl-C, Ctrl-P, etc.)
- View survives layout changes (drag, split, close/reopen)

**Risk flags:**
- Obsidian's key event system may fight xterm.js for certain hotkeys
- xterm.js CSS may conflict with Obsidian themes

---

## Phase 2: PTY Backend Integration

**Goal:** Connect xterm.js to a real shell via a pseudoterminal. Lock the backend choice via a time-boxed spike at the start of this phase. By the end, the plugin runs a default shell with full PTY behavior — colors, interactive programs, Ctrl-C, terminal resize.

**Dependencies:** Phase 1 complete. PTY backend decision made.

**Success criteria:**
- Commands execute in a real shell with correct output
- ANSI colors and formatting work
- Interactive programs work (vim opens, Ctrl-C interrupts)
- Pane resize sends SIGWINCH, shell reflows correctly
- Closing the view kills the shell process cleanly

**Risk flags:**
- node-pty Electron ABI mismatch (if chosen)
- Rust binary first-launch UX (if chosen)
- Python 3 availability (if chosen)
- Shell environment inheritance (PATH, env vars, working directory)

---

## Phase 3: Profile Picker, Session Management + Multi-Instance

**Goal:** Add the VS Code-style profile picker that discovers shells and tmux sessions, the ability to attach to existing tmux sessions, and support for multiple concurrent terminal instances. These combine into one phase because they share the same abstraction — "what command to pass to the PTY" — and the same UI surface.

**Dependencies:** Phase 2 complete. tmux installed for session features (graceful fallback if absent).

**Success criteria:**
- Picker modal lists discovered shells and running tmux sessions
- User can launch a new shell or attach to an existing tmux session
- Multiple terminal instances run in separate Obsidian panes simultaneously
- Each instance independently closable
- Graceful handling when tmux isn't installed or has no sessions

**Risk flags:**
- Shell discovery edge cases (Homebrew shells, nix, non-standard paths)
- tmux server not running → `tmux list-sessions` fails
- Resource consumption with multiple instances

---

## Phase 4: Settings, Polish + Distribution

**Goal:** Make the plugin installable and configurable. Settings UI (default shell, font size, theme, keybindings), Obsidian theme integration (light/dark), distribution packaging (GitHub release with bundled PTY backend), and edge case fixes from dogfooding.

**Dependencies:** Phase 3 complete. Dogfooding feedback collected.

**Success criteria:**
- Settings tab with user-configurable options
- Terminal theme follows Obsidian light/dark mode
- Installable from a GitHub release with no manual steps beyond plugin install
- PTY backend dependency handled automatically on first use
- No orphaned processes under any close/unload/quit scenario

**Risk flags:**
- Binary distribution through Obsidian's plugin ecosystem has no established pattern
- Obsidian version updates can break native module builds
- Community plugin review requirements (if pursued later)

---

## Verification

After each phase, the plugin should be testable by:
1. Building with the project's build command
2. Copying output to `~/.obsidian/plugins/obsidian-terminal-plugin/` (or symlinking during dev)
3. Enabling in Obsidian settings → Community plugins
4. Exercising the features added in that phase
