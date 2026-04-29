import { spawn, ChildProcess } from "child_process";
import { TerminalBackend } from "./terminal-backend";
import { buildSpawnArgs } from "./spawn-args";
import { parsePortLine } from "./port-discovery";
import { encodeInput, encodeResize, decodeServerMessage } from "./protocol-client";

export interface PtyBackendOptions {
  binaryPath: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  env?: NodeJS.ProcessEnv;
  shellArgs?: string[];
}

type ExitInfo = { status: number | null; signal: number | null };

export class PtyBackend implements TerminalBackend {
  private child: ChildProcess | null = null;
  private socket: WebSocket | null = null;
  private dataHandlers: Array<(data: string | Uint8Array) => void> = [];
  private exitHandlers: Array<(info: ExitInfo) => void> = [];
  private closed = false;
  private exitFired = false;

  constructor(private readonly opts: PtyBackendOptions) {}

  async start(): Promise<void> {
    const args = buildSpawnArgs({
      shell: this.opts.shell,
      cwd: this.opts.cwd,
      cols: this.opts.cols,
      rows: this.opts.rows,
      shellArgs: this.opts.shellArgs,
    });
    const env = { TERM: "xterm-256color", ...(this.opts.env ?? process.env) };
    const child = spawn(this.opts.binaryPath, args, {
      cwd: this.opts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    child.on("error", (err) => this.fail(`failed to spawn pty-server: ${err.message}`));
    child.on("exit", (code) => {
      this.fireExit({
        status: typeof code === "number" ? code : null,
        signal: null,
      });
    });

    const port = await this.readPort(child);
    if (port === null) {
      this.fail("pty-server did not announce a port");
      throw new Error("pty-server port discovery failed");
    }

    await this.connectSocket(port);
  }

  private readPort(child: ChildProcess): Promise<number | null> {
    return new Promise((resolve) => {
      let buf = "";
      const stdout = child.stdout;
      if (!stdout) return resolve(null);
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf-8");
        const newlineIdx = buf.indexOf("\n");
        if (newlineIdx >= 0) {
          const line = buf.slice(0, newlineIdx);
          stdout.off("data", onData);
          resolve(parsePortLine(line));
        }
      };
      stdout.on("data", onData);
      const timer = setTimeout(() => {
        stdout.off("data", onData);
        resolve(null);
      }, 5000);
      stdout.once("end", () => clearTimeout(timer));
    });
  }

  private connectSocket(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      this.socket = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => {
        this.fail("websocket connection error");
        reject(new Error("websocket failed"));
      };
      ws.onmessage = (ev) => {
        const text = typeof ev.data === "string" ? ev.data : "";
        const msg = decodeServerMessage(text);
        if (!msg) return;
        if (msg.type === "output") {
          for (const h of this.dataHandlers) h(msg.data);
        } else if (msg.type === "exit") {
          this.fireExit({ status: msg.status, signal: msg.signal });
        }
      };
      ws.onclose = () => {
        if (!this.exitFired) this.fireExit({ status: null, signal: null });
      };
    });
  }

  write(data: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeInput(data));
    }
  }

  resize(cols: number, rows: number): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeResize(cols, rows));
    }
  }

  onData(handler: (data: string | Uint8Array) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: ExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
      }
    } catch {
      /* ignore */
    }
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }

  childPid(): number | null {
    return this.child?.pid ?? null;
  }

  private fail(message: string): void {
    for (const h of this.dataHandlers) {
      h(`\r\n\x1b[31m[pty-backend] ${message}\x1b[0m\r\n`);
    }
  }

  private fireExit(info: ExitInfo): void {
    if (this.exitFired) return;
    this.exitFired = true;
    for (const h of this.exitHandlers) h(info);
  }
}
