import { TerminalBackend } from "./terminal-backend";

type ExitInfo = { status: number | null; signal: number | null };

export class MockBackend implements TerminalBackend {
  private writes: string[] = [];
  private resizes: Array<{ cols: number; rows: number }> = [];
  private dataHandlers: Array<(data: string | Uint8Array) => void> = [];
  private exitHandlers: Array<(info: ExitInfo) => void> = [];
  private closed = false;

  async start(): Promise<void> {
    /* no-op */
  }

  write(data: string): void {
    if (this.closed) return;
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    this.resizes.push({ cols, rows });
  }

  onData(handler: (data: string | Uint8Array) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: ExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  emitData(data: string | Uint8Array): void {
    for (const h of this.dataHandlers) h(data);
  }

  emitExit(info: ExitInfo): void {
    for (const h of this.exitHandlers) h(info);
  }

  getWrites(): ReadonlyArray<string> {
    return this.writes;
  }

  getResizes(): ReadonlyArray<{ cols: number; rows: number }> {
    return this.resizes;
  }

  isClosed(): boolean {
    return this.closed;
  }
}
