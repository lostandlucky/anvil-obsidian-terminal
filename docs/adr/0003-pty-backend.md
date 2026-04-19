# 0003. PTY backend: custom Rust binary on portable-pty + localhost WebSocket

- **Status:** Accepted
- **Date:** 2026-04-14

## Context

The plugin needs a real PTY: spawning an actual shell (zsh, bash, fish) inside
a pseudoterminal so interactive programs (vim, less, fzf, ssh, brew, the
shell's own line editor) work the way they would in any other terminal. The
Phase 1 mock REPL covered xterm.js wiring but stops short of a real shell.

Three candidate backends were considered before this phase. They have
materially different stories on packaging, native-build complexity,
cross-platform reach, and how much non-Rust dev time they consume.

### Candidate A — Python `pty` helper

A short Python script using stdlib `pty.fork()` + `os.read`/`os.write`,
launched as a subprocess by the plugin, communicating over stdin/stdout pipes.

- ➕ Zero native build. Python ships with macOS.
- ➕ Smallest amount of code. The whole helper is maybe 80 lines.
- ➕ Easy to debug — `python3 helper.py` and type at it.
- ➖ Requires a Python interpreter on the user's machine. macOS has been
  removing the system Python in stages, and "system Python 3" is increasingly
  not a thing you can assume.
- ➖ Pipe-based IPC needs a hand-rolled framing protocol anyway.
- ➖ Subprocess management on the plugin side is fiddlier than a network
  socket — no clean way to peek at "is the helper still alive" without
  polling.
- ➖ No real concurrency story if multi-instance grows up later.

### Candidate B — `node-pty` with prebuilt binaries

The standard Node ecosystem PTY library, used by VS Code and almost every
Electron-based terminal.

- ➕ Battle-tested. VS Code runs it for tens of millions of users.
- ➕ Native to the plugin's Node/TypeScript world — no separate process.
- ➕ Active maintenance, real cross-platform support.
- ➖ Native module. Needs prebuilt binaries that match Obsidian's Electron
  ABI for every supported platform. Obsidian's Electron version is not
  pinned to anything a community plugin author can rely on, and the prebuilds
  available on npm are aimed at Node, not Electron.
- ➖ Rebuilding `node-pty` against the right Electron headers is genuinely
  painful. Past Obsidian plugins that tried this have hit a wall on user
  installs that don't have a build toolchain.
- ➖ Distributing prebuilt binaries cross-Electron-version is its own
  release-engineering project and we are one person.
- ➖ The "compile on first install" fallback is unacceptable UX for a
  manual-install plugin.

### Candidate C — Custom Rust binary on `portable-pty` + localhost WebSocket

A standalone Rust binary that owns the PTY and the spawned shell, exposed to
the plugin over a `127.0.0.1` WebSocket. The plugin spawns the binary as a
subprocess, reads the discovered port from its stdout, and connects.

`portable-pty` is the WezTerm crate — same code that backs WezTerm's PTY,
mature and well-maintained.

- ➕ Self-contained, statically linked binary. No interpreter, no Electron
  ABI matching, no node-gyp.
- ➕ Prior art exists: [Termy](https://github.com/zyphrzero/termy) is an
  Obsidian plugin using exactly this architecture. We can read it for
  reference patterns (port discovery, Gatekeeper workarounds, protocol
  shape) without taking a dependency.
- ➕ The WebSocket boundary is dead simple to mock and test from the
  TypeScript side. xterm.js → WebSocket is a one-line wire.
- ➕ Killing one process kills the whole PTY-side tree. No "did the helper
  leak?" debugging.
- ➕ Resize works through the same WebSocket, no second channel needed.
- ➖ Adds a Rust toolchain to the project's dev requirements. Solo developer
  is comfortable with this, but it raises the bar for any future contributor.
- ➖ Two release artifacts to ship: the JS plugin and the Rust binary.
  Per-arch builds will be needed eventually.
- ➖ macOS Gatekeeper will quarantine the binary on first download. Workaround
  is `xattr -d com.apple.quarantine path/to/pty-server` until codesigning is
  set up in Phase 4.
- ➖ ~5–10 minute first compile (cold dependency cache). Incremental builds
  are sub-second.

## Decision

Use **Candidate C — a custom Rust binary on `portable-pty` exposing a
localhost WebSocket protocol** as the PTY backend.

- The binary lives at `pty-server/` in this repo as its own cargo package,
  sibling to `src/`. Built standalone via `cd pty-server && cargo build
  --release`. Cargo workspace integration with `npm run build` is a Phase 2b
  concern.
- All cargo dependencies are exact-version pinned in `Cargo.toml`, with
  `Cargo.lock` committed. This mirrors Phase 0's pinning discipline for the
  npm side, for the same reasons (reproducibility, deliberate upgrades, no
  silent transitive churn).
- The wire protocol is documented in `pty-server/PROTOCOL.md` and is the
  contract Phase 2b implements against.
- The binary speaks WebSocket text frames carrying line-delimited JSON, with
  binary terminal IO base64-encoded so arbitrary bytes survive. Trade-off:
  ~33% bandwidth overhead on local-loopback IO is irrelevant; uniform
  framing makes the protocol trivially testable and debuggable in `wscat`.
- macOS Gatekeeper is deferred to Phase 4. For Phase 2b dogfooding, the
  documented workaround is `xattr -d com.apple.quarantine
  pty-server/target/release/pty-server` after the first build.

## Consequences

**Easier:**

- The Phase 2b TypeScript side has the simplest possible interface to
  implement: spawn a process, read one line of stdout, open a WebSocket. No
  native module loading, no Electron-ABI matching, no Python-version
  detection.
- Phase 2a was verifiable in complete isolation from Obsidian — `cargo test`
  for the framing layer, plus a Python smoke harness driving the binary
  end-to-end. We learned the Rust + PTY + tokio stack is sound before any
  plugin code touched it.
- Multi-instance (Phase 3) is "spawn another `pty-server` on another port,"
  not "thread-juggle inside one process." Each terminal gets its own crash
  domain.
- `portable-pty` is cross-platform under the hood — when the project
  eventually relaxes ADR-0001, the backend doesn't have to be replaced. Only
  the launch script does.

**Harder:**

- Distribution gets a second artifact. Per-arch Rust binary builds enter the
  picture in Phase 4. Manual install will mean "build the JS, build the
  binary, copy both."
- Codesigning the binary for Gatekeeper is real work that has to happen
  before any non-developer install. ADR for that is deferred to Phase 4.
- Anyone contributing to the plugin now needs a Rust toolchain in addition
  to Node. Solo project, so this is currently zero cost; will be a
  contribution barrier later.
- Two layers of error handling — Rust-side (`anyhow` + `tracing`) and
  TypeScript-side. Errors that originate in the binary need to be observable
  from the plugin side, which the protocol's `exit` message and stderr
  capture in 2b will need to handle.

**Reversible?** Partially. The TypeScript-side `TerminalBackend` interface
that 2b builds will be the abstraction seam. If the Rust binary turns out to
be the wrong call, replacing it with a different backend (e.g. node-pty once
Electron ABI churn settles, or a Python helper for some constrained
deployment) means writing a new backend implementation behind the same
interface, not rewriting the plugin. The Phase 2a code itself is throwaway in
the sense that it can be deleted and replaced — but the protocol shape
(input/output/resize/exit, base64-payload JSON) is general enough that any
replacement could plausibly speak the same wire format.

## Validation

This ADR is written **after** the Phase 2a binary works, not before. The
decision is recorded retrospectively, with the actual lived experience of
the spike informing the consequences section. Concretely, all five Phase 2a
acceptance criteria pass:

- `cd pty-server && cargo build --release` ✓
- `cd pty-server && cargo test` (7 tests on the protocol layer) ✓
- Echo round-trip through `wscat` / `python3 smoke-test.py` ✓
- Resize message changes `tput cols` inside the spawned shell ✓
- WebSocket disconnect kills the spawned shell within 1 second ✓
- SIGINT to the binary leaves no orphaned shell processes ✓

See `specs/anvil/terminal-mvp/phase-2a-completion.md` for details.
