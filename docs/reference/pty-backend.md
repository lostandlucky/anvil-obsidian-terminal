# PTY backend

## What it is

The TypeScript driver for the standalone Rust `pty-server` binary. It lives under `src/pty/` and is the seam between `TerminalContainerView` (xterm.js in an Obsidian `ItemView`) and a real pseudoterminal running a user shell. The backend spawns one `pty-server` child process per tab in the container, discovers the port the child prints on stdout, opens a localhost WebSocket to it, and shuttles framed messages in both directions. Rationale for the Rust-binary-over-WebSocket shape lives in [ADR 0003](../adr/0003-pty-backend.md); the wire protocol is defined in [`pty-server/PROTOCOL.md`](../../pty-server/PROTOCOL.md).

## What it exposes

### `terminal-backend.ts`

The narrow interface the view consumes. Callers that need to substitute a different backend implement this interface.

```typescript
export interface TerminalBackend {
  start(): Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (info: { status: number | null; signal: number | null }) => void): void;
  close(): Promise<void>;
}
```

### `pty-backend.ts`

The production implementation of `TerminalBackend`.

- `PtyBackendOptions` — constructor options: `binaryPath`, `shell`, `cwd`, `cols`, `rows`, optional `env`.
- `PtyBackend` — class implementing `TerminalBackend`. One instance per container tab, one child process per instance. No port pooling, no multiplexing.
  - `constructor(opts: PtyBackendOptions)`
  - `start(): Promise<void>` — spawns `binaryPath` with args from `buildSpawnArgs`, injects `TERM=xterm-256color` into the child env, waits for the port line on stdout (5s timeout), then opens the WebSocket. Resolves once `ws.onopen` fires. Rejects if port discovery fails or the socket errors.
  - `write(data: string): void` — sends an `input` frame if the socket is `OPEN`; drops otherwise.
  - `resize(cols: number, rows: number): void` — sends a `resize` frame if the socket is `OPEN`; drops otherwise.
  - `onData(handler)` — registers a handler for decoded output bytes from the child shell. Multiple handlers allowed.
  - `onExit(handler)` — registers a handler fired at most once, on the first of: protocol `exit` message, WebSocket close, or child `exit` event.
  - `close(): Promise<void>` — idempotent. Closes the WebSocket and, if the child is still alive, sends `SIGTERM` as a backstop.
  - `childPid(): number | null` — returns the child PID if spawned, else `null`.

### `protocol-client.ts`

Pure framing helpers. No Node, no WebSocket, no `obsidian` import — unit-testable under Vitest.

- `ServerMessage` — discriminated union: `{ type: "output"; data: string }` or `{ type: "exit"; status: number | null; signal: number | null }`.
- `encodeInput(data: string): string` — JSON frame `{ type: "input", data: <base64> }`. UTF-8 input is base64-encoded.
- `encodeResize(cols: number, rows: number): string` — JSON frame `{ type: "resize", cols, rows }`.
- `decodeServerMessage(raw: string): ServerMessage | null` — parses one frame. Returns `null` on malformed JSON, unknown `type`, or non-base64 `output.data`.

### `spawn-args.ts`

- `SpawnArgsInput` — `{ shell, cwd, cols, rows }`.
- `buildSpawnArgs(input)` — emits the argv `pty-server` expects: `--shell`, `--cwd`, `--cols`, `--rows`, and — for login-shell-capable shells — `--shell-arg=-l` in the hyphen-equals form the Rust binary parses.
- `isLoginShellCapable(shellPath): boolean` — `true` for basenames `zsh`, `bash`, `sh`.

### `port-discovery.ts`

- `parsePortLine(line: string): number | null` — matches the literal `^PTY_SERVER_LISTENING port=(\d+)$` regex from [`pty-server/PROTOCOL.md`](../../pty-server/PROTOCOL.md). Returns the parsed port or `null` on no match / non-finite number.

## Inputs and outputs

Inputs to a `PtyBackend` instance:

- **Construction** — absolute `binaryPath` (resolved by the view from the plugin manifest dir), `shell`, `cwd`, initial `cols`/`rows`, optional `env`.
- **`write(data)`** — keystrokes and paste data from xterm.js, forwarded as base64-wrapped `input` frames.
- **`resize(cols, rows)`** — viewport dimensions from the xterm fit addon, forwarded as `resize` frames.

Outputs from a `PtyBackend` instance:

- **`onData` handlers** — decoded UTF-8 output bytes from the child shell. Backend errors (spawn failure, missing port line, socket error) are also emitted through this channel as red ANSI lines in the form `\r\n\x1b[31m[pty-backend] <message>\x1b[0m\r\n` so they render inline in the terminal pane. No modals, no notices.
- **`onExit` handlers** — fired once with `{ status, signal }`. `status` is the shell exit code when known; `signal` is the signal number when the shell was killed. Either or both may be `null`.

Lifecycle: `start()` spawns the child, reads stdout until a newline, parses the port line, opens `ws://127.0.0.1:<port>`, and resolves on `open`. `close()` closes the socket and `SIGTERM`s the child if it is still running; it is safe to call more than once.

## What it does not do

- Does not render anything. xterm.js lives in `src/terminal/xterm-host.ts`; the backend never touches the DOM.
- Does not import `obsidian`. The interface is pure Node + `WebSocket`, so `protocol-client.ts`, `spawn-args.ts`, and `port-discovery.ts` run under Vitest without an Obsidian harness.
- Does not pick the shell, cwd, or env. The view supplies those via `PtyBackendOptions`. The default spec uses `process.env.SHELL || "/bin/zsh"` and the vault root; the profile picker (`ProfilePickerModal`) overrides the spec when the user launches via `Cmd-P → Open terminal`.
- Does not resolve `binaryPath`. The view computes it from the plugin manifest `dir` and passes an absolute path.
- Does not multiplex. One `PtyBackend` owns one `pty-server` child which owns one PTY. Multiple tabs in the container mean multiple backends and multiple binaries.
- Does not retry. A failed spawn, a missing port line, or a socket error surfaces as an error line and a rejected `start()`; the view decides what to show. There is no reconnect loop.
- Does not implement profile selection or tmux attach — those live above the view layer in `ProfilePickerModal` and pass a resolved `TerminalTabSpec` into the container view, which then constructs the backend.
- Does not codesign, notarize, or strip Gatekeeper quarantine from the `pty-server` binary. That is an install-time concern.
- Does not own the mock REPL at `src/terminal/mock-repl.ts`. The mock is not wired into the container view; it remains in the tree as offline scaffold and is not referenced by the PTY backend.
