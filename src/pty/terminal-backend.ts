export interface TerminalBackend {
  start(): Promise<void>;
  /** User-keystroke input bound for the PTY. Always a string at this layer
   *  — xterm.js emits onData strings from keyboard events. */
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** PTY output bound for the terminal renderer. Pass-through is bytes
   *  (Uint8Array) from the WebSocket transport; mock backends that
   *  synthesize output for tests may emit strings. xterm.js's
   *  terminal.write() accepts both. */
  onData(handler: (data: string | Uint8Array) => void): void;
  onExit(handler: (info: { status: number | null; signal: number | null }) => void): void;
  close(): Promise<void>;
}
