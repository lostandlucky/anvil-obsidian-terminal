export type ServerMessage =
  | { type: "output"; data: Uint8Array }
  | { type: "exit"; status: number | null; signal: number | null };

export function encodeInput(data: string): string {
  const b64 = Buffer.from(data, "utf-8").toString("base64");
  return JSON.stringify({ type: "input", data: b64 });
}

export function encodeResize(cols: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols, rows });
}

export function decodeServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type === "output" && typeof obj.data === "string") {
    if (!isValidBase64(obj.data)) return null;
    try {
      // Return raw bytes — xterm.js's parser maintains UTF-8 decode state
      // across consecutive write() calls, so a multi-byte sequence split
      // across two PTY-output messages reassembles correctly. Calling
      // .toString("utf-8") here would corrupt partial sequences into
      // U+FFFD (the replacement character), which then renders as visible
      // garbage in the terminal.
      const buf = Buffer.from(obj.data, "base64");
      return { type: "output", data: new Uint8Array(buf) };
    } catch {
      return null;
    }
  }
  if (obj.type === "exit") {
    const status = typeof obj.status === "number" ? obj.status : null;
    const signal = typeof obj.signal === "number" ? obj.signal : null;
    return { type: "exit", status, signal };
  }
  return null;
}

function isValidBase64(s: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(s);
}
