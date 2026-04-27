import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PtyBackend } from "./pty-backend";

/**
 * AC4: lifecycle/dispose tests for PtyBackend.
 *
 * The full happy path requires a real pty-server child + WebSocket, which is
 * exercised in pty-backend.e2e.ts. These unit tests pin the dispose contract
 * by injecting fakes into a partially-constructed instance — we create the
 * backend without calling start(), then attach fake child + socket to verify
 * close() does the right thing.
 */
describe("PtyBackend.close() (AC4)", () => {
  type FakeChild = {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    killed: NodeJS.Signals[];
    kill: (signal: NodeJS.Signals) => void;
  };

  type FakeSocket = {
    readyState: number;
    closed: boolean;
    close: () => void;
  };

  function makeBackend(): PtyBackend {
    return new PtyBackend({
      binaryPath: "/dev/null/pty-server",
      shell: "/bin/sh",
      cwd: "/",
      cols: 80,
      rows: 24,
    });
  }

  function makeChild(): FakeChild {
    const killed: NodeJS.Signals[] = [];
    return {
      exitCode: null,
      signalCode: null,
      killed,
      kill(signal: NodeJS.Signals) {
        killed.push(signal);
      },
    };
  }

  function makeSocket(readyState = 1 /* OPEN */): FakeSocket {
    return {
      readyState,
      closed: false,
      close() {
        this.closed = true;
      },
    };
  }

  it("calls kill('SIGTERM') on the child process when close() is invoked", async () => {
    const backend = makeBackend();
    const child = makeChild();
    const socket = makeSocket();
    // Inject the fakes through the private fields (lifecycle test).
    (backend as unknown as { child: FakeChild }).child = child;
    (backend as unknown as { socket: FakeSocket }).socket = socket;

    await backend.close();

    expect(child.killed).toContain("SIGTERM");
  });

  it("closes the websocket when close() is invoked", async () => {
    const backend = makeBackend();
    const child = makeChild();
    const socket = makeSocket();
    (backend as unknown as { child: FakeChild }).child = child;
    (backend as unknown as { socket: FakeSocket }).socket = socket;

    await backend.close();

    expect(socket.closed).toBe(true);
  });

  it("does not kill an already-exited child (status set)", async () => {
    const backend = makeBackend();
    const child = makeChild();
    child.exitCode = 0;
    (backend as unknown as { child: FakeChild }).child = child;
    (backend as unknown as { socket: FakeSocket }).socket = makeSocket();

    await backend.close();

    expect(child.killed).toEqual([]);
  });

  it("does not kill a child that received a signal", async () => {
    const backend = makeBackend();
    const child = makeChild();
    child.signalCode = "SIGTERM";
    (backend as unknown as { child: FakeChild }).child = child;
    (backend as unknown as { socket: FakeSocket }).socket = makeSocket();

    await backend.close();

    expect(child.killed).toEqual([]);
  });

  it("does not throw if close() is called twice", async () => {
    const backend = makeBackend();
    const child = makeChild();
    const socket = makeSocket();
    (backend as unknown as { child: FakeChild }).child = child;
    (backend as unknown as { socket: FakeSocket }).socket = socket;

    await backend.close();
    await expect(backend.close()).resolves.toBeUndefined();
    // SIGTERM only sent once, even with two close() calls.
    expect(child.killed.filter((s) => s === "SIGTERM").length).toBe(1);
  });

  it("does not throw if close() is called before start()", async () => {
    const backend = makeBackend();
    // No child, no socket.
    await expect(backend.close()).resolves.toBeUndefined();
  });

  it("does not attempt to close a non-OPEN socket", async () => {
    const backend = makeBackend();
    const child = makeChild();
    const socket = makeSocket(0 /* CONNECTING */);
    (backend as unknown as { child: FakeChild }).child = child;
    (backend as unknown as { socket: FakeSocket }).socket = socket;

    await backend.close();

    // Socket close is skipped when not OPEN — guards against runtime errors
    // on partially-connected sockets.
    expect(socket.closed).toBe(false);
  });

  it("swallows kill() errors so close() always resolves", async () => {
    const backend = makeBackend();
    const child = makeChild();
    child.kill = () => {
      throw new Error("ESRCH");
    };
    (backend as unknown as { child: FakeChild }).child = child;
    (backend as unknown as { socket: FakeSocket }).socket = makeSocket();

    await expect(backend.close()).resolves.toBeUndefined();
  });
});
