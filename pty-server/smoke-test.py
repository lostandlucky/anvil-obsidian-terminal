#!/usr/bin/env python3
"""End-to-end smoke test for pty-server (Phase 2a).

Spawns the release binary, opens a WebSocket, drives the spawned shell,
verifies output round-trips, resize works, and disconnect cleans up the
child process. Exits 0 on success, non-zero with diagnostics on failure.

Run from the repo root or from pty-server/:
    python3 smoke-test.py
"""

import asyncio
import base64
import json
import os
import re
import subprocess
import sys
import time

import websockets


BINARY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "target", "release", "pty-server")
SHELL = os.environ.get("SHELL", "/bin/zsh")


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def from_b64(s: str) -> bytes:
    return base64.b64decode(s)


def input_msg(text: str) -> str:
    return json.dumps({"type": "input", "data": b64(text.encode())})


def resize_msg(cols: int, rows: int) -> str:
    return json.dumps({"type": "resize", "cols": cols, "rows": rows})


async def collect_until(ws, pattern: str, timeout: float = 3.0) -> str:
    """Read output messages until `pattern` (regex) matches accumulated text."""
    accumulated = ""
    rx = re.compile(pattern)
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=deadline - asyncio.get_event_loop().time())
        except asyncio.TimeoutError:
            break
        parsed = json.loads(msg)
        if parsed.get("type") == "output":
            accumulated += from_b64(parsed["data"]).decode("utf-8", errors="replace")
            if rx.search(accumulated):
                return accumulated
    raise AssertionError(
        f"pattern {pattern!r} not seen within {timeout}s. Got:\n{accumulated}"
    )


def shell_processes_under_cwd(cwd: str) -> list[str]:
    """ps output lines for any shell processes whose cwd or command references our marker."""
    out = subprocess.run(
        ["ps", "-eo", "pid,command"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [line for line in out.splitlines() if cwd in line and "pty-server" not in line]


async def main() -> int:
    if not os.path.exists(BINARY):
        print(f"FAIL: binary not found at {BINARY}. Run `cargo build --release`.", file=sys.stderr)
        return 1

    cwd = os.getcwd()
    proc = subprocess.Popen(
        [BINARY, "--shell", SHELL, "--shell-arg", "-l", "--cwd", cwd, "--cols", "80", "--rows", "24"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        # Read port from stdout.
        port_line = proc.stdout.readline()
        m = re.match(r"PTY_SERVER_LISTENING port=(\d+)", port_line.strip())
        if not m:
            print(f"FAIL: unexpected first stdout line: {port_line!r}", file=sys.stderr)
            print("stderr:", proc.stderr.read(), file=sys.stderr)
            return 1
        port = int(m.group(1))
        print(f"PASS: port discovery — listening on {port}")

        url = f"ws://127.0.0.1:{port}"
        async with websockets.connect(url) as ws:
            print("PASS: websocket connected")

            # Smoke 1: echo round-trip
            # Use unique tokens that won't accidentally appear in shell echo/redraw.
            await ws.send(input_msg('printf "ROUNDTRIP_OK_%s\\n" hello\n'))
            await collect_until(ws, r"ROUNDTRIP_OK_hello")
            print("PASS: smoke 1 — printf output round-trips through PTY")

            # Smoke 2: resize → tput cols
            await ws.send(resize_msg(123, 30))
            await asyncio.sleep(0.1)  # give SIGWINCH time to land
            await ws.send(input_msg('printf "COLS=%s\\n" "$(tput cols)"\n'))
            out = await collect_until(ws, r"COLS=123\b")
            print("PASS: smoke 2 — resize message changes tput cols")

            # Capture shell PID before disconnect.
            await ws.send(input_msg('printf "SHELLPID=%s\\n" "$$"\n'))
            out = await collect_until(ws, r"SHELLPID=\d+")
            pid_match = re.search(r"SHELLPID=(\d+)", out)
            assert pid_match, f"could not capture shell PID from:\n{out}"
            shell_pid = int(pid_match.group(1))
            print(f"PASS: captured shell PID {shell_pid}")

        # WebSocket closed. Smoke 3: shell process should be gone within 1s.
        deadline = time.time() + 1.5
        gone = False
        while time.time() < deadline:
            try:
                os.kill(shell_pid, 0)
            except ProcessLookupError:
                gone = True
                break
            time.sleep(0.05)
        if not gone:
            print(f"FAIL: smoke 3 — shell pid {shell_pid} still alive 1.5s after disconnect", file=sys.stderr)
            return 1
        print(f"PASS: smoke 3 — shell pid {shell_pid} cleaned up after disconnect")

        # Smoke 4: kill the binary with SIGINT, ensure no orphaned shells from this run.
        # Re-launch a fresh session, capture pid, then SIGINT the binary.
        proc2 = subprocess.Popen(
            [BINARY, "--shell", SHELL, "--shell-arg", "-l", "--cwd", cwd],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        port_line2 = proc2.stdout.readline()
        port2 = int(re.match(r"PTY_SERVER_LISTENING port=(\d+)", port_line2.strip()).group(1))

        async with websockets.connect(f"ws://127.0.0.1:{port2}") as ws2:
            await ws2.send(input_msg('printf "SHELLPID=%s\\n" "$$"\n'))
            out2 = await collect_until(ws2, r"SHELLPID=\d+")
            shell_pid2 = int(re.search(r"SHELLPID=(\d+)", out2).group(1))

            # Send SIGINT to the binary (simulating Ctrl-C in its terminal).
            proc2.send_signal(2)  # SIGINT
            try:
                proc2.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc2.kill()
                print("FAIL: smoke 4 — binary did not exit on SIGINT", file=sys.stderr)
                return 1

        deadline = time.time() + 1.5
        gone = False
        while time.time() < deadline:
            try:
                os.kill(shell_pid2, 0)
            except ProcessLookupError:
                gone = True
                break
            time.sleep(0.05)
        if not gone:
            print(f"FAIL: smoke 4 — orphaned shell pid {shell_pid2} after binary SIGINT", file=sys.stderr)
            return 1
        print(f"PASS: smoke 4 — binary SIGINT killed shell pid {shell_pid2}, no orphans")

        return 0

    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
