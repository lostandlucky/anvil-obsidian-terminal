export interface TerminalBackend {
  start(): Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (info: { status: number | null; signal: number | null }) => void): void;
  close(): Promise<void>;
}
