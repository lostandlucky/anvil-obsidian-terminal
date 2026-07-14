# pty-server WebSocket Protocol

This binary spawns a shell inside a real PTY and exposes it over a localhost
WebSocket. This document is the contract a client (e.g. the Obsidian plugin in
Phase 2b) needs to implement — sufficient on its own, no Rust-source reading
required.

## Scope and threat model

- **Localhost only.** The binary binds `127.0.0.1:0`. There is no
  authentication. The trust boundary is the local machine — anything that can
  connect to the loopback interface can drive the spawned shell. This is fine
  inside a single-user dev machine, which is the entire supported environment
  (see ADR-0001).
- **One connection at a time.** The accept loop is serial. A second client
  trying to connect while a session is in progress will queue at the TCP layer
  and only complete its handshake after the active session ends. Phase 2a does
  not support multiplexing.
- **Kill on close.** When the WebSocket client disconnects, the spawned shell
  is killed. Reattach is Phase 3's tmux story, not this binary's.

## Launching the binary

```
pty-server \
  --shell /bin/zsh \
  --shell-arg=-l \
  --cwd /path/to/working/directory \
  [--cols 80] [--rows 24]
```

Flags:

| Flag | Required | Notes |
|---|---|---|
| `--shell` | yes | Absolute path to the shell binary to spawn. |
| `--shell-arg` | no, repeatable | Argument passed to the shell. **Use `=` form** for hyphen-leading values: `--shell-arg=-l`. |
| `--cwd` | yes | Initial working directory for the shell. |
| `--cols` | no, default 80 | Initial PTY columns. |
| `--rows` | no, default 24 | Initial PTY rows. |

Logs go to **stderr** (via `tracing` at INFO level). Stdout is reserved for the
port-discovery line and nothing else.

## Port discovery

Immediately after binding, the binary writes one line to stdout:

```
PTY_SERVER_LISTENING port=12345
```

…then continues running. The port is whatever the OS assigned when the binary
asked for `127.0.0.1:0`. A client should:

1. Spawn the binary as a child process.
2. Read the first line of its stdout.
3. Parse with the literal regex `^PTY_SERVER_LISTENING port=(\d+)$`.
4. Connect to `ws://127.0.0.1:<port>`.

There is no separate handshake file. If you need to know when the binary is
ready, the stdout line is the signal.

## Wire format

WebSocket **text frames** carry **single-line JSON objects**. Every message is
tagged by a `"type"` field. Binary payloads (terminal IO) are **base64-encoded
strings** so arbitrary bytes — including control characters and escape
sequences — survive a round-trip through JSON.

The base64 overhead (~33%) is acceptable for local-loopback terminal IO and
makes the protocol uniform and trivially debuggable in `wscat`.

### Client → server

#### `input`

Raw bytes from the user's keyboard, written into the PTY master. The shell sees
these as if typed.

```json
{"type":"input","data":"<base64 of raw bytes>"}
```

Example (sending `echo hi\n`):

```json
{"type":"input","data":"ZWNobyBoaQo="}
```

#### `resize`

Updates the PTY's window size. Triggers a `SIGWINCH` to the child, so curses
apps (vim, less, tmux) reflow immediately.

```json
{"type":"resize","cols":120,"rows":40}
```

Both fields are unsigned 16-bit integers. Sent any time the client's terminal
view changes size.

### Server → client

#### `output`

Raw bytes the shell wrote to the PTY (stdout, stderr, escape sequences). The
client decodes the base64 and feeds the bytes to its terminal emulator
(xterm.js).

```json
{"type":"output","data":"<base64 of raw bytes>"}
```

Output messages are emitted as the binary reads chunks from the PTY (up to
8 KiB per chunk). No batching guarantees beyond "what the kernel returned in
one read."

#### `exit`

Sent once, immediately before the binary closes the WebSocket, when the
spawned shell has exited (or the binary is shutting down).

```json
{"type":"exit","status":0,"signal":null}
```

- `status`: integer exit code from the child, or `null` if the binary couldn't
  observe one.
- `signal`: integer signal number that killed the child, or `null`. Currently
  always `null` — the binary doesn't yet distinguish status from signal in the
  portable-pty `ExitStatus`. Reserved for future use; clients should accept it.

After sending `exit`, the binary sends a WebSocket Close frame and tears down.
The whole goodbye sequence (`exit` + Close) is **best-effort and time-bounded**
(250ms): a live localhost peer always receives it, but a peer that is gone or
has stopped reading cannot stall the binary's exit. Clients must not depend on
receiving `exit` when they initiated the teardown themselves.

### Unknown / malformed messages

A client message that fails JSON parsing, has an unknown `type`, or contains
an invalid base64 payload is **logged and ignored**. The session continues.
This keeps protocol evolution non-breaking: a future client can send
`{"type":"hello",...}` against an old binary and just have it dropped.

## Lifecycle

```
client                        pty-server
  │                              │
  │  spawn process               │
  │ ───────────────────────────► │
  │                              │ bind 127.0.0.1:0
  │  read stdout line            │ print "PTY_SERVER_LISTENING port=N"
  │ ◄─────────────────────────── │
  │                              │
  │  ws connect ws://127.0.0.1:N │
  │ ───────────────────────────► │ accept_async
  │                              │ openpty + spawn shell
  │                              │
  │  {type:input, data:...}      │
  │ ───────────────────────────► │ write to PTY
  │                              │
  │  {type:output, data:...}     │ read from PTY
  │ ◄─────────────────────────── │
  │                              │
  │  {type:resize, cols, rows}   │
  │ ───────────────────────────► │ master.resize → SIGWINCH
  │                              │
  │  ws close                    │
  │ ───────────────────────────► │ kill child
  │                              │
  │  {type:exit, status, signal} │
  │ ◄─────────────────────────── │
  │  ws close                    │
  │ ◄─────────────────────────── │
```

Either side can initiate close. If the binary receives SIGINT or SIGTERM, it
kills the child, sends `exit`, closes the WebSocket, and exits — sub-second
even while mid-flood to a dead or unresponsive peer: an in-flight WebSocket
send is abandoned the moment shutdown triggers, and the goodbye sequence is
time-bounded (see above).

If the parent process dies without sending any signal (force-quit, crash,
OOM-kill), a kqueue parent-death watchdog (`EVFILT_PROC | NOTE_EXIT` on the
parent PID) triggers the same shutdown path — the binary never outlives its
parent. It never exits merely because a live session is quiet: there is no
timeout- or inactivity-based reaping of any kind.

## Trying it by hand

### With `wscat` (recommended)

```bash
# Terminal A — start the binary
./target/release/pty-server --shell /bin/zsh --shell-arg=-l --cwd "$PWD"

# It prints:
#   PTY_SERVER_LISTENING port=54321

# Terminal B — connect with wscat
npx wscat -c ws://127.0.0.1:54321

# Send an input message (echo "hello\n" base64-encoded):
> {"type":"input","data":"ZWNobyBoZWxsbwo="}

# You should see output messages come back, e.g.:
< {"type":"output","data":"ZWNobyBoZWxsbw0KaGVsbG8NCg=="}
```

Decode the base64 in the response — you'll see the typed line being echoed by
the terminal, then `hello` from the actual command.

### With the smoke-test harness

```bash
cd pty-server
cargo build --release
python3 smoke-test.py
```

This drives the full protocol non-interactively and asserts on echo,
resize-via-`tput cols`, disconnect cleanup, and SIGINT cleanup. Useful as a
regression check after any binary change.

## Versioning

Phase 2a is unversioned. Phase 2b is the first consumer; if the protocol
changes after 2b ships, add a `version` field to a handshake message and bump
deliberately. Don't try to support multiple versions in 2a — it's a spike.
